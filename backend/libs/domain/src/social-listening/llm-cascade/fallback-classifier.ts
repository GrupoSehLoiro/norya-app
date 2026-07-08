/**
 * FallbackKeywordClassifier — M4 LLM-07.
 *
 * Computa o `Tier2Output` (mesmo shape que o Haiku produz) usando só
 * heurística: counts já decorados pelo tier-1 (perUser.posCount/negCount),
 * categorias via match nas tokenFreq, marcas via `detectBrands` (já roda
 * antes do classificador), AD sentiment via os perUser counts dos
 * usuários da janela durante AD.
 *
 * Tier reportado: 0 (fallback indicado) ou 1 (só heur por escolha).
 *
 * Quando usar:
 *   - circuit breaker do AnthropicService OPEN (Fase 5)
 *   - budget de tokens esgotado (RED-03 LlmRateLimiter)
 *   - flag `ai.fallback.forceOnly` ativada para debug
 *   - LLM_DRIVER=mock e o mock decidir simular fallback
 */
import type { BatchAggregate } from '../types';
import type { BrandHit } from '../brand-detector';
import type { ClassifierConfigs, Tier2Output } from './types';

export interface FallbackInput {
  aggregate: BatchAggregate;
  configs: ClassifierConfigs;
  brandHits: BrandHit[];
  /** Min msgs do user para entrar no ranking tóxico (evita ruído). */
  minMsgsForToxRanking?: number;
  /** Tier a reportar (0 = forced fallback, 1 = só heurístico). */
  llmTier?: 0 | 1;
}

const DEFAULT_MIN_MSGS = 3;

export function classifyFallback(input: FallbackInput): Tier2Output {
  const { aggregate, configs, brandHits, llmTier = 0 } = input;
  const minMsgs = input.minMsgsForToxRanking ?? DEFAULT_MIN_MSGS;

  // 1. Sentiment global a partir do perUser (já preenchido pelo tier-1).
  let totalPos = 0;
  let totalNeg = 0;
  let totalNeu = 0;
  for (const u of aggregate.perUser) {
    totalPos += u.posCount;
    totalNeg += u.negCount;
    totalNeu += u.neuCount;
  }
  const totalHints = totalPos + totalNeg + totalNeu;
  const sentiment =
    totalHints > 0
      ? { pos: totalPos / totalHints, neg: totalNeg / totalHints, neu: totalNeu / totalHints }
      : { pos: 0, neg: 0, neu: 0 };

  // 2. Categorias — somar match de tokenFreq contra cada category.keywords.
  const catCounts = new Map<string, number>();
  for (const [tok, freq] of aggregate.tokenFreq) {
    for (const [cat, kws] of configs.categories) {
      if (kws.has(tok)) {
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + freq);
      }
    }
  }
  const topCategories = Array.from(catCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // 3. Toxic ranking — filtra users com msgCount>=min, ordena por
  //    ratio negativo (negCount/msgCount).
  const eligible = aggregate.perUser.filter((u) => u.msgCount >= minMsgs);
  const toxRanking = eligible
    .map((u) => ({
      username: u.username,
      msgCount: u.msgCount,
      negCount: u.negCount,
      ratio: u.msgCount === 0 ? 0 : u.negCount / u.msgCount,
    }))
    .sort((a, b) => b.ratio - a.ratio || b.msgCount - a.msgCount);

  const topToxic = toxRanking.filter((u) => u.negCount > 0).slice(0, 5);

  // 4. Menos tóxico — argmax de pos/total entre eligible.
  let leastToxicUser: Tier2Output['leastToxicUser'] = null;
  let bestPosRatio = -1;
  for (const u of eligible) {
    const r = u.msgCount === 0 ? 0 : u.posCount / u.msgCount;
    if (r > bestPosRatio || (r === bestPosRatio && (leastToxicUser?.msgCount ?? 0) < u.msgCount)) {
      bestPosRatio = r;
      leastToxicUser = {
        username: u.username,
        ratio: r,
        msgCount: u.msgCount,
        posCount: u.posCount,
      };
    }
  }
  // Só vale se tem pelo menos 1 msg positiva
  if (leastToxicUser && leastToxicUser.posCount === 0) {
    leastToxicUser = null;
  }

  // 5. Brand mentions — já calculadas externamente
  const mentionedBrands: BrandHit[] = brandHits;

  // 6. AD sentiment — quando aggregate.adActive=true, o sentiment global
  //    da janela JÁ é o do AD (toda a janela tá sob ad break). Para
  //    janelas parciais o orchestrator pode chamar duas vezes em
  //    sub-janelas; aqui mantemos uma única visão.
  const adSentiment: Tier2Output['adSentiment'] = aggregate.adActive
    ? {
        active: true,
        source: aggregate.adSource,
        pos: totalPos,
        neg: totalNeg,
        neu: totalNeu,
        sampleSize: aggregate.totalMsgs,
      }
    : null;

  // 7. Confidence — proporção de msgs com hint definitivo dividido por totalMsgs.
  const confidence = aggregate.totalMsgs === 0 ? 0 : Math.min(1, totalHints / aggregate.totalMsgs);

  // Heurística pode pedir escalation se confiança < 0.4 e janela
  // razoavelmente populosa.
  const needsEscalation = confidence < 0.4 && aggregate.totalMsgs > 20;

  return {
    sentiment,
    topCategories,
    topToxicUsers: topToxic,
    leastToxicUser,
    mentionedBrands,
    adSentiment,
    confidence,
    needsEscalation,
    reasoning: `fallback heurístico, ${totalHints}/${aggregate.totalMsgs} msgs com hint`,
    llmTier,
    llmModel: 'fallback-keyword',
    llmCostUsd: 0,
    llmLatencyMs: 0,
    llmCacheHitRate: 0,
  };
}
