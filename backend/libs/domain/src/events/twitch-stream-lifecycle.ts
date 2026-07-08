/**
 * Cross-process event contract for Twitch stream lifecycle.
 *
 * O worker (apps/worker) recebe notifications EventSub via TwitchEventSubWsClient
 * e publica esses eventos no event bus (RedisEventBus em produção). A API
 * (apps/api) subscreve no MonitoringModule (MON-03) para abrir/fechar
 * LiveSession automaticamente.
 *
 * Os nomes dos channels são strings estáveis: usados como key no Redis
 * pub/sub, NÃO REFATORAR sem coordenar publisher e subscriber juntos.
 */

export const STREAM_ONLINE_CHANNEL = 'twitch.stream.online';
export const STREAM_OFFLINE_CHANNEL = 'twitch.stream.offline';

export interface TwitchStreamOnlinePayload {
  /** broadcaster_user_id da Twitch — chave externa do Channel. */
  channelExternalId: string;
  /** broadcaster_user_login — útil para logs e fallback de lookup. */
  broadcasterUserLogin: string;
  /** ISO string para sobreviver a serialização JSON via Redis. */
  startedAt: string;
  /** Tipo da stream (live, playlist, etc.). */
  streamType?: string;
}

export interface TwitchStreamOfflinePayload {
  channelExternalId: string;
  broadcasterUserLogin: string;
  /** Timestamp em que o worker observou o offline. */
  observedAt: string;
}
