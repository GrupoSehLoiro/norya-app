/**
 * Barrel do pacote @sehloro/domain.
 *
 * Regra arquitetural: este pacote NÃO pode depender de @nestjs/*, mongoose,
 * pino ou qualquer framework. Aqui vivem entidades, value objects, contracts
 * de repositório e erros de domínio. Infra e API importam daqui, nunca o
 * contrário.
 */
export * from './errors/domain-error';
export * from './shared/identity';
export * from './shared/slug';
export * from './shared/br-document';

// Identity bounded context
export * from './identity/user.entity';
export * from './identity/user.repository.port';
export * from './identity/refresh-token.entity';
export * from './identity/refresh-token.repository.port';
export * from './identity/workspace.entity';
export * from './identity/workspace.repository.port';
export * from './identity/membership.entity';
export * from './identity/membership.repository.port';
export * from './identity/email-verification-code.entity';
export * from './identity/email-verification-code.repository.port';
export * from './identity/billing/plans';

// Creator bounded context
export * from './creator/creator.entity';
export * from './creator/creator.repository.port';
export * from './creator/creator-profile.entity';
export * from './creator/creator-profile.repository.port';

// Ingestion bounded context
export * from './ingestion/channel.entity';
export * from './ingestion/channel.repository.port';
export * from './ingestion/channel-oauth-token.entity';
export * from './ingestion/channel-oauth-token.repository.port';
export * from './ingestion/chat-provider';
export * from './ingestion/raw-message';
export * from './ingestion/raw-message.schema';
export * from './ingestion/emote-dictionary';

// Monitoring bounded context
export * from './monitoring/live-session.entity';
export * from './monitoring/live-session.repository.port';

// Events
export * from './events/event-bus';
export * from './events/twitch-stream-lifecycle';
export * from './events/twitch-legacy-feed';

// Social listening — M4 IA core (Fase 2: PIPE-01/02/03 + EMO-02)
export * from './social-listening';
