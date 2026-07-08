/**
 * `@CurrentUser()` — extrai o payload já validado pelo `JwtStrategy.validate`.
 *
 * Uso:
 *   @Get('me')
 *   getMe(@CurrentUser() user: AuthUser) { ... }
 *
 * O shape é o que a strategy retorna: `{ sub, username, email, role }`.
 * Mantemos o tipo `AuthUser` aqui para ser o único ponto de verdade do
 * shape do principal autenticado.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole, WsRole } from '@sehloro/domain';

export interface AuthUser {
  sub: string;
  username: string;
  email: string;
  role: UserRole;
  /** Workspace ativo do token (tenant atual). Ausente em tokens legados. */
  activeWorkspaceId?: string;
  /** Role do usuário NO workspace ativo (RBAC). Ausente em tokens legados. */
  wsRole?: WsRole;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user;
  },
);
