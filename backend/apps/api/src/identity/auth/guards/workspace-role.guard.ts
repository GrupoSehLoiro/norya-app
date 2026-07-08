/**
 * WorkspaceRoleGuard — autorização por role no workspace ativo (RBAC).
 *
 * Roda DEPOIS do JwtAuthGuard global (já populou `req.user`). Para rotas
 * anotadas com `@RequireWsRole(min)`:
 *  1. lê `wsRole` do token (`AuthUser`); se ausente (token legado), tenta
 *     resolver via `MembershipRepository` usando `activeWorkspaceId`;
 *  2. compara contra o mínimo exigido via `wsRoleSatisfies`.
 *
 * Sem `@RequireWsRole`, o guard é no-op (só o JWT global protege).
 * Sem workspace ativo / sem membership → 403.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  MEMBERSHIP_REPOSITORY,
  MembershipRepository,
  WsRole,
  wsRoleSatisfies,
} from '@sehloro/domain';
import { WS_ROLE_KEY } from '../decorators/require-ws-role.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';

@Injectable()
export class WorkspaceRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<WsRole | undefined>(WS_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true; // rota não exige role de workspace

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException({ message: 'Não autenticado' });
    }

    let role = user.wsRole;
    const workspaceId = user.activeWorkspaceId;

    // Token sem claim de role (legado / pré-workspace): resolve no banco.
    if (!role && workspaceId) {
      const m = await this.memberships.findByUserAndWorkspace(user.sub, workspaceId);
      role = m && m.isActive() ? m.getRole() : undefined;
    }

    if (!role || !workspaceId) {
      throw new ForbiddenException({
        message: 'Sem workspace ativo para autorizar',
        code: 'NO_ACTIVE_WORKSPACE',
      });
    }

    if (!wsRoleSatisfies(role, required)) {
      throw new ForbiddenException({
        message: 'Permissão insuficiente neste workspace',
        code: 'INSUFFICIENT_WS_ROLE',
      });
    }
    return true;
  }
}
