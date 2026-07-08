/**
 * JwtAuthGuard — global. Registrado como `APP_GUARD` em `IdentityModule`.
 *
 * Comportamento:
 *  1. Se o handler (ou o controller inteiro) está marcado com `@Public()`,
 *     devolve `true` sem olhar header.
 *  2. Caso contrário, delega para o `AuthGuard('jwt')` do Passport.
 *     Sobrescrevemos `handleRequest` para emitir mensagens de erro IDÊNTICAS
 *     às do legado Express (`SLMOD-api/api/middleware/authMiddleware.js`):
 *       - Sem header Authorization → 401 `{ message: 'Token não fornecido' }`.
 *       - Token inválido / expirado / header malformado → 401
 *         `{ message: 'Token inválido' }`.
 *     Isso preserva o contrato HTTP do frontend (`SLMOD-platform`).
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Override do passport: normalmente ele lança `UnauthorizedException` com
   * a mensagem padrão do Nest. Aqui precisamos diferenciar "sem header" de
   * "header presente mas inválido" para bater 1:1 com o legado.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      const req = context.switchToHttp().getRequest<Request>();
      const authHeader = req.headers?.authorization;
      // Se não tem header OU se tem mas não é Bearer → 'Token não fornecido'.
      // Caso contrário (token presente mas inválido/expirado) → 'Token inválido'.
      const hasBearer =
        typeof authHeader === 'string' &&
        authHeader.trim().toLowerCase().startsWith('bearer ') &&
        authHeader.trim().split(/\s+/).length >= 2 &&
        authHeader.trim().split(/\s+/)[1].length > 0;

      const message = hasBearer ? 'Token inválido' : 'Token não fornecido';
      throw new UnauthorizedException({ message });
    }
    return user;
  }
}
