/**
 * Bootstrap do PRIMEIRO admin — resolve o ovo-e-galinha da gestão de acesso
 * ("admin só é criado por admin, mas o banco nasce vazio").
 *
 * Com INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD no ambiente, o boot
 * garante (idempotente) que esse usuário exista com role=admin:
 *  - não existe → cria ativo/verificado via AdminUsersService;
 *  - existe     → NÃO altera (nem senha, nem role) — só loga. Promover conta
 *    existente por env seria um vetor de escalada silenciosa; promoção é
 *    ação explícita de outro admin pela página de gestão de acesso.
 *
 * Sem as envs, é no-op — produção pode preferir criar o primeiro admin por
 * seed controlado e nunca deixar credencial em env.
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USER_REPOSITORY, UserRepository } from '@sehloro/domain';
import { AdminUsersService } from './admin-users.service';

@Injectable()
export class AdminUsersBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminUsersBootstrap.name);

  constructor(
    private readonly config: ConfigService,
    private readonly adminUsers: AdminUsersService,
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get<string>('INITIAL_ADMIN_EMAIL')?.trim().toLowerCase();
    const password = this.config.get<string>('INITIAL_ADMIN_PASSWORD');
    if (!email || !password) return;

    try {
      const existing = await this.userRepo.findByEmail(email);
      if (existing) {
        if (existing.getRole() !== 'admin') {
          this.logger.warn(
            `INITIAL_ADMIN_EMAIL=${email} já existe com role=${existing.getRole()} — ` +
              'NÃO promovido automaticamente; use a gestão de acesso.',
          );
        }
        return;
      }
      await this.adminUsers.createUser({
        email,
        password,
        displayName: 'Admin',
        role: 'admin',
      });
      this.logger.log(`Admin inicial ${email} criado via INITIAL_ADMIN_* (bootstrap)`);
    } catch (err) {
      // Boot não cai por causa do seed de admin — loga e segue.
      this.logger.error(`Falha no bootstrap do admin inicial: ${(err as Error).message}`);
    }
  }
}
