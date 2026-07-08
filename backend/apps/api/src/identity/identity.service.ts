import { Injectable } from '@nestjs/common';

/**
 * Bounded context: Identity.
 *
 * Responsável por autenticação, autorização, usuários, roles e sessões.
 * Consome `SLMOD-api/api/controllers/users.js` no strangler — migração
 * real entra no sprint AUTH.
 */
@Injectable()
export class IdentityService {}
