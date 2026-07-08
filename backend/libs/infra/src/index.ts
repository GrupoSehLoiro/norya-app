/**
 * Barrel do pacote @sehloro/infra.
 *
 * Implementações concretas dos contracts definidos em @sehloro/domain
 * + infraestrutura compartilhada entre apps (config schema, clients
 * Mongo/ClickHouse/Redis).
 */
export * from './config/config.schema';

// Crypto — AUTH-02
export * from './crypto/crypto.service';
export * from './crypto/crypto.module';
export * from './crypto/crypto-error';
export * from './crypto/encrypted-field.decorator';
export * from './crypto/mongoose-encryption.plugin';

// Persistence (Mongoose) — NEST-04 / AUTH-01 / AUTH-02
export * from './persistence/mongoose/persistence.module';
export * from './persistence/mongoose/schemas/user.schema';
export * from './persistence/mongoose/schemas/channel.schema';
export * from './persistence/mongoose/schemas/refresh-token.schema';
export * from './persistence/mongoose/schemas/channel-oauth-token.schema';
export * from './persistence/mongoose/schemas/worker-state.schema';
export * from './persistence/mongoose/repositories/user.mongoose.repository';
export * from './persistence/mongoose/repositories/channel.mongoose.repository';
export * from './persistence/mongoose/repositories/refresh-token.mongoose.repository';
export * from './persistence/mongoose/repositories/channel-oauth-token.mongoose.repository';
// Identity / tenant / billing — Fase 1 (sign-up / onboarding)
export * from './persistence/mongoose/schemas/workspace.schema';
export * from './persistence/mongoose/schemas/membership.schema';
export * from './persistence/mongoose/schemas/email-verification-code.schema';
export * from './persistence/mongoose/schemas/creator.schema';
export * from './persistence/mongoose/schemas/creator-profile.schema';
export * from './persistence/mongoose/schemas/brand-catalog.schema';
export * from './persistence/mongoose/repositories/workspace.mongoose.repository';
export * from './persistence/mongoose/repositories/membership.mongoose.repository';
export * from './persistence/mongoose/repositories/email-verification-code.mongoose.repository';
export * from './persistence/mongoose/repositories/creator.mongoose.repository';
export * from './persistence/mongoose/repositories/creator-profile.mongoose.repository';

export * as UserMapper from './persistence/mongoose/mappers/user.mapper';
export * as ChannelMapper from './persistence/mongoose/mappers/channel.mapper';
export * as ChannelOAuthTokenMapper from './persistence/mongoose/mappers/channel-oauth-token.mapper';

// Ingestion chat providers — CHAT-01/02/03/04/TWI-01
export * from './ingestion/tokens';
export * from './ingestion/mock/mock-chat-provider';
export * from './ingestion/chat-provider.factory';
export * from './ingestion/chat.module';
export * from './ingestion/twitch-irc/twitch-irc.provider';
export * from './ingestion/twitch-irc/twitch-message.mapper';
export * from './ingestion/twitch-irc/twitch-helix.service';
export * from './ingestion/twitch-irc/twitch-token-refresher';
export * from './ingestion/twitch-irc/twitch-oauth.service';

// Kick — KCK-01/KCK-02/KCK-03/KCK-04
export * from './ingestion/kick-pusher/kick-oauth.service';
export * from './ingestion/kick-pusher/kick-message.mapper';
export * from './ingestion/kick-pusher/kick-pusher.provider';
export * from './ingestion/kick-pusher/kick-rest.client';

// Twitch EventSub Conduits — CON-01/CON-02/CON-05
export * from './ingestion/twitch-conduit/twitch-conduit.service';
export * from './ingestion/twitch-conduit/twitch-conduit-subscriptions.service';
export * from './ingestion/twitch-conduit/subscription-renewer.service';
export * from './persistence/mongoose/schemas/twitch-conduit-state.schema';
export * from './persistence/mongoose/schemas/twitch-eventsub-subscription.schema';

// Monitoring persistence — MON-01
export * from './persistence/mongoose/schemas/live-session.schema';
export * from './persistence/mongoose/repositories/live-session.mongoose.repository';

// Feature flags persistence — FF-01
export * from './persistence/mongoose/schemas/feature-flag.schema';
export * from './persistence/mongoose/schemas/access-log.schema';

// Legacy collections (read-only) — ver docs/technical/legacy-module.md
export * from './persistence/mongoose/schemas/ban.schema';
export * from './persistence/mongoose/schemas/timeout.schema';
export * from './persistence/mongoose/schemas/message-deleted.schema';
export * from './persistence/mongoose/schemas/prediction.schema';
export * from './persistence/mongoose/schemas/poll.schema';
export * from './persistence/mongoose/schemas/chat-emoji.schema';

// Cache / EventBus — RED-04, RED-01, RED-02, RED-03
export * from './cache/in-memory-event-bus';
export * from './cache/redis-event-bus';
export * from './cache/cache.module';
export * from './cache/chat-buffer';
export * from './cache/sliding-window';
export * from './cache/llm-rate-limiter';

// Access logs — persistência consultável de "quem acessou o quê"
export * from './logging/access-log.service';
export * from './logging/access-log.module';

// Analytics — M4 IA core (Fase 1: CH-01/02/03 base)
export * from './analytics/clickhouse';

// Social listening adapters — M4 IA core (Fase 2: PIPE-01 Redis dedup)
export * from './social-listening';

// LLM cascade adapters — M4 IA core (Fase 5: Anthropic mock+real+fallback)
export * from './llm';

// Email — Fase 1 (verificação de email no sign-up)
export * from './email/email-sender.port';
export * from './email/log-email.sender';
export * from './email/resend-email.sender';
export * from './email/smtp-email.sender';
export * from './email/email.module';
