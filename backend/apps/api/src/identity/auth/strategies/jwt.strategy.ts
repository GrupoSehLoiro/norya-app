/**
 * JwtStrategy — validação de tokens de acesso emitidos pela API NestJS
 * E pela API Express legada (interop durante a transição strangler).
 *
 * Interop de payload:
 * - Tokens NOVOS (emitidos por `AuthService.login` aqui) vêm com
 *   `{ sub, username, email, role, iat, exp }`.
 * - Tokens LEGADOS (emitidos por `SLMOD-api/api/controllers/users.controller.js`)
 *   vêm com `{ userId, username, email, role, iat, exp }` — o campo do
 *   principal é `userId`, não `sub`.
 *
 * `validate()` aceita os dois formatos: prioriza `sub`; se ausente, mapeia
 * `userId` → `sub`. Isso permite que tokens emitidos pelo legado continuem
 * funcionando no backend novo até o legado ser desligado. Quando virar
 * exclusivamente Nest, podemos apertar a validação e rejeitar `userId`.
 *
 * A strategy é stateless — NÃO consulta o banco aqui. Se precisar de role
 * fresh ou revogação imediata, introduza um `AuthMiddleware` ou um Guard
 * dedicado que leia `USER_REPOSITORY`. Para access tokens de 15min isso é
 * aceitável; rotação imediata passa pelo refresh.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { UserRole, WsRole } from '@sehloro/domain';
import type { AppConfig } from '../../../config/config.schema';
import type { AuthUser } from '../decorators/current-user.decorator';

interface JwtPayload {
  sub?: string;
  /** Campo legado do SLMOD-api Express (payload antigo). */
  userId?: string;
  username?: string;
  email?: string;
  role?: UserRole;
  /** Claims novos de tenancy/RBAC (ausentes em tokens legados). */
  activeWorkspaceId?: string;
  wsRole?: WsRole;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // `infer: true` garante o tipo string do JWT_SECRET via AppConfig
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  /**
   * Chamado pelo passport após verificar assinatura + expiração. O retorno
   * vira `req.user`. Lançar `UnauthorizedException` aqui é tratado pelo
   * `JwtAuthGuard.handleRequest` (não chega no filter direto).
   */
  validate(payload: JwtPayload): AuthUser {
    const sub = payload.sub ?? payload.userId;
    if (!sub) {
      // Sem `sub` nem `userId` — token malformado para nosso universo.
      throw new UnauthorizedException({ message: 'Token inválido' });
    }
    return {
      sub,
      username: payload.username ?? '',
      email: payload.email ?? '',
      role: (payload.role ?? 'user') as UserRole,
      activeWorkspaceId: payload.activeWorkspaceId,
      wsRole: payload.wsRole,
    };
  }
}
