/**
 * `@RequireWsRole(minRole)` — declara o role mínimo (no workspace ativo) que
 * uma rota exige. Lido pelo `WorkspaceRoleGuard` via Reflector. A hierarquia
 * (owner > admin > manager > analyst > viewer) está em `wsRoleSatisfies`.
 *
 * Ex.: `@RequireWsRole('manager')` aceita manager, admin e owner.
 */
import { SetMetadata } from '@nestjs/common';
import type { WsRole } from '@sehloro/domain';

export const WS_ROLE_KEY = 'requiredWsRole';

export const RequireWsRole = (role: WsRole) => SetMetadata(WS_ROLE_KEY, role);
