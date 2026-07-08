/**
 * AuthService — autenticação JWT + refresh rotation + sign-up com verificação
 * de email (1x) + tenancy (workspace ativo nos claims).
 *
 * Fluxos:
 *  - `register`: cria User (pending_email) + Workspace pessoal + Membership
 *    owner, gera código e envia por email. NÃO emite JWT.
 *  - `verifyEmail`: valida o código → ativa a conta → emite par access/refresh
 *    com claims de workspace.
 *  - `resendCode`: reenvia código (idempotente, anti-enumeration).
 *  - `login`: valida credenciais (email ou username); bloqueia se pendente de
 *    verificação; emite par com claims de workspace.
 *  - `refresh` / `logout`: rotação + revogação (detecção de reuse — OAuth BCP §4.12).
 *  - `getMe` / `activateWorkspace`: contexto de tenancy para o console.
 *
 * Segredos: refresh token e código de email só transitam em plaintext uma vez;
 * o banco guarda só o SHA-256.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EMAIL_SENDER, EmailSender } from '@sehloro/infra';
import {
  EMAIL_VERIFICATION_CODE_REPOSITORY,
  EmailVerificationCode,
  EmailVerificationCodeRepository,
  MEMBERSHIP_REPOSITORY,
  Membership,
  MembershipRepository,
  REFRESH_TOKEN_REPOSITORY,
  RefreshToken,
  RefreshTokenRepository,
  User,
  USER_REPOSITORY,
  UserRepository,
  Workspace,
  WORKSPACE_REPOSITORY,
  WorkspaceRepository,
  WsRole,
  slugify,
} from '@sehloro/domain';
import type { AppConfig } from '../../config/config.schema';
import type { LoginDto } from './dto/login.dto';
import type { RefreshDto } from './dto/refresh.dto';
import type { RegisterDto } from './dto/register.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import type { ResendCodeDto } from './dto/resend-code.dto';
import { PasswordHasher } from './password-hasher';

const MAX_CODE_ATTEMPTS = 5;
const DEFAULT_CODE_TTL_MIN = 15;

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: string;
  displayName: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends AuthTokens {
  user: AuthenticatedUser;
  activeWorkspaceId: string | null;
  wsRole: WsRole | null;
}

export interface RegisterResult {
  status: 'pending_email';
  email: string;
}

export interface MeResult {
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    displayName: string | null;
    avatarUrl: string | null;
    locale: string | null;
    status: string;
    emailVerified: boolean;
    onboardingCompleted: boolean;
  };
  activeWorkspaceId: string | null;
  wsRole: WsRole | null;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    type: string;
    planKey: string;
    role: WsRole;
  }>;
}

interface ActiveWorkspace {
  workspaceId: string;
  role: WsRole;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY)
    private readonly refreshRepo: RefreshTokenRepository,
    @Inject(WORKSPACE_REPOSITORY)
    private readonly workspaceRepo: WorkspaceRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(EMAIL_VERIFICATION_CODE_REPOSITORY)
    private readonly codeRepo: EmailVerificationCodeRepository,
    @Inject(EMAIL_SENDER)
    private readonly email: EmailSender,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly hasher: PasswordHasher,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // Sign-up + verificação de email
  // ─────────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      // Não vaza se está ativo ou pendente — só impede duplicar.
      throw new ForbiddenException({
        message: 'Email já cadastrado',
        code: 'EMAIL_TAKEN',
      });
    }

    const passwordHash = await this.hasher.hash(dto.password);
    const displayName = dto.displayName?.trim() || email.split('@')[0];

    // username legado = email (schema exige username único).
    const user = await this.userRepo.save(
      User.create({
        username: email,
        email,
        passwordHash,
        status: 'pending_email',
        displayName,
      }),
    );

    // Tipo de conta → tipo do workspace (streamer = creator).
    const accountType = dto.accountType ?? 'streamer';
    const workspaceType = accountType === 'streamer' ? 'creator' : accountType;
    // streamer = pessoa física (CPF); agency/brand = pessoa jurídica (CNPJ).
    const documentType = accountType === 'streamer' ? ('cpf' as const) : ('cnpj' as const);

    // Workspace pessoal (tenant) + membership owner.
    const slug = await this.uniqueWorkspaceSlug(displayName);
    const workspace = await this.workspaceRepo.save(
      Workspace.create({
        name: displayName,
        ownerUserId: user.getId(),
        type: workspaceType,
        slug,
        planKey: 'free',
        document: dto.document ?? null,
        documentType: dto.document ? documentType : null,
      }),
    );
    await this.membershipRepo.save(
      Membership.create({
        workspaceId: workspace.getId(),
        userId: user.getId(),
        role: 'owner',
      }),
    );

    await this.issueAndSendCode(user.getId(), email);
    return { status: 'pending_email', email };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException({ message: 'Código inválido' });
    }

    const code = await this.codeRepo.findLatestActiveByEmail(email);
    if (!code) {
      throw new UnauthorizedException({
        message: 'Nenhum código ativo — solicite um novo',
        code: 'NO_ACTIVE_CODE',
      });
    }
    if (code.isExpired()) {
      throw new UnauthorizedException({
        message: 'Código expirado — solicite um novo',
        code: 'CODE_EXPIRED',
      });
    }
    if (!code.canAttempt(MAX_CODE_ATTEMPTS)) {
      throw new UnauthorizedException({
        message: 'Muitas tentativas — solicite um novo código',
        code: 'TOO_MANY_ATTEMPTS',
      });
    }

    if (code.getCodeHash() !== this.hashCode(dto.code)) {
      code.registerAttempt();
      await this.codeRepo.save(code);
      throw new UnauthorizedException({ message: 'Código inválido' });
    }

    code.consume();
    await this.codeRepo.save(code);
    user.markEmailVerified();
    const saved = await this.userRepo.save(user);

    const ws = await this.resolveActiveWorkspace(saved.getId());
    return await this.buildLoginResult(saved, ws);
  }

  async resendCode(dto: ResendCodeDto): Promise<{ ok: true }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userRepo.findByEmail(email);
    // Anti-enumeration: sempre responde ok. Só age se o usuário existe e está
    // pendente de verificação.
    if (user && user.getStatus() === 'pending_email') {
      await this.codeRepo.invalidateAllForEmail(email);
      await this.issueAndSendCode(user.getId(), email);
    }
    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Login / refresh / logout
  // ─────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = dto.email
      ? await this.userRepo.findByEmail(dto.email.trim().toLowerCase())
      : await this.userRepo.findByUsername(dto.username as string);

    if (!user) {
      throw new UnauthorizedException({ message: 'Credenciais inválidas' });
    }
    const ok = await user.validatePassword(dto.password, (plain, hash) =>
      this.hasher.compare(plain, hash),
    );
    if (!ok) {
      throw new UnauthorizedException({ message: 'Credenciais inválidas' });
    }

    if (user.getStatus() === 'pending_email') {
      throw new ForbiddenException({
        message: 'Confirme seu email para continuar',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.getEmail(),
      });
    }
    if (user.getStatus() === 'disabled') {
      throw new ForbiddenException({ message: 'Conta desativada' });
    }

    const ws = await this.resolveActiveWorkspace(user.getId());
    return await this.buildLoginResult(user, ws);
  }

  async refresh(dto: RefreshDto): Promise<AuthTokens> {
    const hash = this.hashRefresh(dto.refreshToken);
    const found = await this.refreshRepo.findByTokenHash(hash);

    if (!found) {
      throw new UnauthorizedException({ message: 'Refresh inválido' });
    }
    if (found.isRevoked()) {
      this.logger.warn(
        `Refresh reuse detectado para userId=${found.getUserId()} tokenId=${found.getId()}`,
      );
      await this.refreshRepo.revokeAllByUserId(found.getUserId());
      throw new UnauthorizedException({
        message: 'Refresh reutilizado — sessão revogada',
      });
    }
    if (found.isExpired()) {
      throw new UnauthorizedException({ message: 'Refresh expirado' });
    }

    const user = await this.userRepo.findById(found.getUserId());
    if (!user) {
      await this.refreshRepo.revoke(found.getId(), 'user-not-found');
      throw new UnauthorizedException({ message: 'Refresh inválido' });
    }

    await this.refreshRepo.revoke(found.getId(), 'rotated');

    const ws = await this.resolveActiveWorkspace(user.getId());
    const accessToken = this.signAccessTokenFor(user, ws);
    const { plaintext: refreshToken } = await this.issueRefreshToken(user.getId(), found.getId());
    return { accessToken, refreshToken };
  }

  async logout(dto: RefreshDto): Promise<void> {
    const hash = this.hashRefresh(dto.refreshToken);
    const found = await this.refreshRepo.findByTokenHash(hash);
    if (found && !found.isRevoked()) {
      await this.refreshRepo.revoke(found.getId(), 'logout');
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Tenancy (contexto do console)
  // ─────────────────────────────────────────────────────────────────────

  async getMe(userId: string): Promise<MeResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ message: 'Usuário não encontrado' });
    }

    const memberships = (await this.membershipRepo.findByUserId(userId)).filter((m) =>
      m.isActive(),
    );

    const workspaces: MeResult['workspaces'] = [];
    for (const m of memberships) {
      const ws = await this.workspaceRepo.findById(m.getWorkspaceId());
      if (ws) {
        workspaces.push({
          id: ws.getId(),
          name: ws.getName(),
          slug: ws.getSlug(),
          type: ws.getType(),
          planKey: ws.getPlanKey(),
          role: m.getRole(),
        });
      }
    }

    const active = this.pickActiveWorkspace(memberships);
    return {
      user: {
        id: user.getId(),
        username: user.getUsername(),
        email: user.getEmail(),
        role: user.getRole(),
        displayName: user.getDisplayName(),
        avatarUrl: user.getAvatarUrl(),
        locale: user.getLocale(),
        status: user.getStatus(),
        emailVerified: user.isEmailVerified(),
        onboardingCompleted: user.isOnboardingCompleted(),
      },
      activeWorkspaceId: active?.workspaceId ?? null,
      wsRole: active?.role ?? null,
      workspaces,
    };
  }

  /** Reemite o access token apontando para outro workspace do usuário. */
  async activateWorkspace(userId: string, workspaceId: string): Promise<AuthTokens> {
    const membership = await this.membershipRepo.findByUserAndWorkspace(userId, workspaceId);
    if (!membership || !membership.isActive()) {
      throw new ForbiddenException({
        message: 'Sem acesso a este workspace',
        code: 'NOT_A_MEMBER',
      });
    }
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ message: 'Usuário não encontrado' });
    }
    const ws: ActiveWorkspace = {
      workspaceId,
      role: membership.getRole(),
    };
    const accessToken = this.signAccessTokenFor(user, ws);
    const { plaintext: refreshToken } = await this.issueRefreshToken(userId, null);
    return { accessToken, refreshToken };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internos
  // ─────────────────────────────────────────────────────────────────────

  private async resolveActiveWorkspace(userId: string): Promise<ActiveWorkspace | null> {
    const memberships = (await this.membershipRepo.findByUserId(userId)).filter((m) =>
      m.isActive(),
    );
    return this.pickActiveWorkspace(memberships);
  }

  private pickActiveWorkspace(memberships: Membership[]): ActiveWorkspace | null {
    if (memberships.length === 0) return null;
    // Prioriza o workspace onde é owner; senão o primeiro ativo.
    const owner = memberships.find((m) => m.getRole() === 'owner');
    const chosen = owner ?? memberships[0];
    return { workspaceId: chosen.getWorkspaceId(), role: chosen.getRole() };
  }

  private async buildLoginResult(user: User, ws: ActiveWorkspace | null): Promise<LoginResult> {
    const accessToken = this.signAccessTokenFor(user, ws);
    const { plaintext: refreshToken } = await this.issueRefreshToken(user.getId(), null);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.getId(),
        username: user.getUsername(),
        email: user.getEmail(),
        role: user.getRole(),
        displayName: user.getDisplayName(),
      },
      activeWorkspaceId: ws?.workspaceId ?? null,
      wsRole: ws?.role ?? null,
    };
  }

  private signAccessTokenFor(user: User, ws: ActiveWorkspace | null): string {
    // Fallback '15m' defende boots sem Zod (ex.: TestingModule sem validate).
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true }) ?? '15m';
    return this.jwtService.sign(
      {
        sub: user.getId(),
        username: user.getUsername(),
        email: user.getEmail(),
        role: user.getRole(),
        ...(ws ? { activeWorkspaceId: ws.workspaceId, wsRole: ws.role } : {}),
      },
      { expiresIn },
    );
  }

  private async issueRefreshToken(
    userId: string,
    rotatedFromId: string | null,
  ): Promise<{ plaintext: string; entity: RefreshToken }> {
    const plaintext = randomBytes(64).toString('hex');
    const tokenHash = this.hashRefresh(plaintext);
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true }) ?? 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const entity = RefreshToken.create({
      userId,
      tokenHash,
      expiresAt,
      rotatedFromId,
    });
    const saved = await this.refreshRepo.save(entity);
    return { plaintext, entity: saved };
  }

  private hashRefresh(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private hashCode(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private async issueAndSendCode(userId: string, email: string): Promise<void> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ttlMin = this.config.get('EMAIL_CODE_TTL_MIN', { infer: true }) ?? DEFAULT_CODE_TTL_MIN;
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);
    await this.codeRepo.save(
      EmailVerificationCode.create({
        userId,
        email,
        codeHash: this.hashCode(code),
        expiresAt,
      }),
    );
    await this.email.send({
      to: email,
      subject: 'Seu código de verificação SEHLORO',
      text:
        `Seu código de verificação é: ${code}\n\n` +
        `Ele expira em ${ttlMin} minutos. Se você não criou uma conta, ignore este email.`,
    });
  }

  private async uniqueWorkspaceSlug(name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    for (let i = 0; i < 5; i += 1) {
      const exists = await this.workspaceRepo.findBySlug(slug);
      if (!exists) return slug;
      slug = `${base}-${randomBytes(2).toString('hex')}`;
    }
    return `${base}-${randomBytes(4).toString('hex')}`;
  }
}
