import { Injectable } from '@nestjs/common';

/**
 * Bounded context: Moderation.
 *
 * Dono dos agregados de bans, timeouts, logs de moderadores, mensagens
 * deletadas e regras de enforcement. No legado corresponde a
 * `ban`, `timeout`, `logMods`, `messageDeleted` em SLMOD-api.
 */
@Injectable()
export class ModerationService {}
