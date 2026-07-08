export * from './types';
export * from './stopwords-pt-br';
export * from './text-normalizer';
export * from './emote-token-replacer';
export * from './copypasta-dedup.port';
export * from './window-aggregator.service';

// Fase 3 — Brand allowlist + AD segments
export * from './ad-segment.entity';
export * from './ad-segment.repository.port';
export * from './channel-brand.entity';
export * from './channel-brand.repository.port';
export * from './brand-detector';

// Fase 4 — LLM cascade (tier-1 heurístico + fallback)
export * from './llm-cascade';
