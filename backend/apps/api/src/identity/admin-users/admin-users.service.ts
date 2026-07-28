/**
 * AdminUsersService — gestão de acesso (rotas /api/v2/admin/users).
 *
 * Regras:
 *  - Criar usuário com role arbitrário (admin/moderator/user) é EXCLUSIVO
 *    daqui — o sign-up público (AuthService.register) sempre nasce 'user'
 *    e o RegisterDto nem aceita `role`.
 *  - Usuário criado por admin nasce ATIVO e com email verificado (não passa
 *    pelo fluxo de código) — quem criou responde pela identidade.
 *  - Espelha o register no que importa para o console funcionar: workspace
 *    pessoal + membership owner.
 *  - changeRole nunca permite o admin rebaixar A SI MESMO (anti-lockout).
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MEMBERSHIP_REPOSITORY,
  Membership,
  MembershipRepository,
  slugify,
  User,
  USER_REPOSITORY,
  UserRepository,
  UserRole,
  Workspace,
  WORKSPACE_REPOSITORY,
  WorkspaceRepository,
} from '@sehloro/domain';
import { PasswordHasher } from '../auth/password-hasher';
import { UserCascadeService } from './user-cascade.service';

export interface AdminUserView {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
}

function toView(user: User): AdminUserView {
  return {
    id: user.getId(),
    email: user.getEmail(),
    username: user.getUsername(),
    displayName: user.getDisplayName(),
    role: user.getRole(),
    status: user.getStatus(),
    emailVerified: user.isEmailVerified(),
  };
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: WorkspaceRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly membershipRepo: MembershipRepository,
    private readonly hasher: PasswordHasher,
    private readonly cascade: UserCascadeService,
  ) {}

  async list(): Promise<AdminUserView[]> {
    const users = await this.userRepo.findAll();
    return users.map(toView);
  }

  async createUser(input: {
    email: string;
    password: string;
    displayName?: string;
    role: UserRole;
  }): Promise<AdminUserView> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictException({ message: 'Email já cadastrado', code: 'EMAIL_TAKEN' });
    }

    const passwordHash = await this.hasher.hash(input.password);
    const displayName = input.displayName?.trim() || email.split('@')[0] || email;

    const user = User.create({
      username: email,
      email,
      passwordHash,
      role: input.role,
      status: 'active',
      displayName,
    });
    // Criado por admin ⇒ identidade atestada por quem criou; sem código de email.
    user.markEmailVerified();
    const saved = await this.userRepo.save(user);

    // Workspace pessoal + membership owner — paridade com o sign-up público.
    const slug = await this._uniqueWorkspaceSlug(displayName);
    const workspace = await this.workspaceRepo.save(
      Workspace.create({
        name: displayName,
        ownerUserId: saved.getId(),
        type: 'creator',
        slug,
        planKey: 'free',
        document: null,
        documentType: null,
      }),
    );
    await this.membershipRepo.save(
      Membership.create({
        workspaceId: workspace.getId(),
        userId: saved.getId(),
        role: 'owner',
      }),
    );

    this.logger.log(`Usuário ${email} criado via gestão de acesso (role=${input.role})`);
    return toView(saved);
  }

  async changeRole(input: {
    targetUserId: string;
    role: UserRole;
    actingUserId: string;
  }): Promise<AdminUserView> {
    if (input.targetUserId === input.actingUserId) {
      throw new ForbiddenException({
        message: 'Você não pode alterar o próprio papel (anti-lockout)',
        code: 'SELF_ROLE_CHANGE',
      });
    }
    const user = await this.userRepo.findById(input.targetUserId);
    if (!user) throw new NotFoundException({ message: 'Usuário não encontrado' });

    user.changeRole(input.role);
    const saved = await this.userRepo.save(user);
    this.logger.log(`Role de ${saved.getEmail()} alterado para ${input.role}`);
    return toView(saved);
  }

  /**
   * Apaga o usuário e TODOS os dados dele (workspaces, creators, canais,
   * tokens, sessões, análises — ver UserCascadeService). Nunca a si mesmo:
   * anti-lockout igual ao changeRole.
   */
  async deleteUser(input: { targetUserId: string; actingUserId: string }): Promise<void> {
    if (input.targetUserId === input.actingUserId) {
      throw new ForbiddenException({
        message: 'Você não pode apagar o próprio usuário (anti-lockout)',
        code: 'SELF_DELETE',
      });
    }
    await this.cascade.deleteUserCascade(input.targetUserId);
  }

  private async _uniqueWorkspaceSlug(name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; i < 50; i++) {
      const taken = await this.workspaceRepo.findBySlug(slug);
      if (!taken) return slug;
      slug = `${base}-${i}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
