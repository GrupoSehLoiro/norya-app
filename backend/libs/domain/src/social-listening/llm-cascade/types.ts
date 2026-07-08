/**
 * Tipos do tier-2/tier-3 (mesmo shape independente do classificador real
 * ser Haiku ou fallback heurístico). M4 Fase 4 + 5.
 */
import type { BrandHit } from '../brand-detector';

/** Output canônico do classificador tier-2 (LLM ou fallback). */
export interface Tier2Output {
  /** Ratios pos+neg+neu = 1 (ou ~1 com tolerância). */
  sentiment: { pos: number; neg: number; neu: number };
  /** Pautas (categorias detectadas) ordenadas desc por count. */
  topCategories: { category: string; count: number }[];
  /** Ranking de usuários por toxicidade (negCount/total). */
  topToxicUsers: { username: string; ratio: number; msgCount: number; negCount: number }[];
  /** Menos tóxico = melhor ratio positivo. */
  leastToxicUser: { username: string; ratio: number; msgCount: number; posCount: number } | null;
  /** Marcas mencionadas (do BrandDetector ou enriquecido pelo LLM). */
  mentionedBrands: BrandHit[];
  /** Sentimento na janela DURANTE ad. null se ad não estava ativo. */
  adSentiment: {
    active: boolean;
    source: 'twitch' | 'manual' | null;
    pos: number;
    neg: number;
    neu: number;
    sampleSize: number;
  } | null;
  confidence: number; // 0..1
  needsEscalation: boolean;
  reasoning?: string;
  /** Frase curta da IA sobre o contexto da pauta/categoria mais comentada. */
  dominantCategoryContext?: string;
  /** Tier real que produziu o output: 0=fallback, 1=heur-only, 2=Haiku, 3=Sonnet. */
  llmTier: 0 | 1 | 2 | 3;
  llmModel: string;
  llmCostUsd: number;
  llmLatencyMs: number;
  llmCacheHitRate: number;
}

/** Listas que vivem hoje no Mongo (`sentimentConfiguration`, `categoryConfiguration`). */
export interface ClassifierConfigs {
  /** keywords → 'positive' | 'negative' | 'neutral' */
  sentiment: {
    positive: ReadonlySet<string>;
    negative: ReadonlySet<string>;
    neutral: ReadonlySet<string>;
  };
  /** category name → keywords */
  categories: ReadonlyMap<string, ReadonlySet<string>>;
  /** palavras que disparam drop_moderation */
  blockedWords: ReadonlySet<string>;
  /** usernames bloqueados (drop_moderation) */
  blockedUsers: ReadonlySet<string>;
  /** usernames de bot — drop_bot */
  botUsers: ReadonlySet<string>;
}

export function emptyConfigs(): ClassifierConfigs {
  return {
    sentiment: { positive: new Set(), negative: new Set(), neutral: new Set() },
    categories: new Map(),
    blockedWords: new Set(),
    blockedUsers: new Set(),
    botUsers: new Set(),
  };
}
