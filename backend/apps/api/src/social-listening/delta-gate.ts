/**
 * Delta-gate — decide quando um batch pode REAPROVEITAR a análise semântica
 * do último tier-2 real em vez de chamar o LLM de novo.
 *
 * Racional de custo: em regime estável (just chatting, grind de gameplay) as
 * janelas consecutivas são "mais do mesmo" — mesmos tokens dominantes, mesma
 * distribuição de sentimento. Pagar o prompt inteiro do Haiku para reafirmar
 * a mesma pauta é desperdício. O gate compara a janela atual com a última que
 * passou pelo LLM e, se for suficientemente similar, monta o output a partir
 * do fallback heurístico (números FRESCOS da janela: sentimento, tóxicos,
 * marcas, ad) + os campos semânticos reaproveitados (categorias + contexto
 * da pauta), marcando `llmTier: 1` para a telemetria distinguir.
 *
 * Salvaguardas (qualquer uma força o LLM):
 *   - memória velha (> maxAgeMs) ou inexistente;
 *   - N reusos consecutivos (re-âncora periódica — o chat deriva);
 *   - último tier-2 não veio do LLM (fallback não é fonte semântica);
 *   - último tier-2 pediu escalação;
 *   - estado de AD mudou (ad_sentiment precisa de análise própria);
 *   - salto de volume, pra cima OU pra baixo (razão fora de
 *     [1/maxVolumeRatio, maxVolumeRatio] — o chat mudou de regime);
 *   - tokens dominantes divergiram (Jaccard < minJaccard);
 *   - sentimento divergiu (distância L1 das distribuições > maxSentDelta).
 *
 * Funções puras — testáveis sem Nest/Redis/LLM.
 */
import type { BatchAggregate, Tier2Output } from '@sehloro/domain';

/** Última análise tier-2 real de um canal + a assinatura da janela que a gerou. */
export interface Tier2Snapshot {
  at: number;
  topTokens: ReadonlySet<string>;
  sentDist: { pos: number; neg: number; neu: number };
  totalMsgsWeighted: number;
  adActive: boolean;
  tier2: Tier2Output;
  /** Reusos consecutivos desde a última chamada real. */
  reuseCount: number;
}

export interface DeltaGateOptions {
  /** Reusos consecutivos permitidos antes de forçar re-âncora no LLM. */
  maxReuse: number;
  /** Idade máxima da memória (ms). */
  maxAgeMs: number;
  /** Jaccard mínimo entre os topTokens das duas janelas. */
  minJaccard: number;
  /** Distância L1 máxima entre as distribuições de sentimento (0..2). */
  maxSentDelta: number;
  /**
   * Razão de volume (atual/anterior) fora da qual o reuso é vetado. Aplica
   * nos DOIS sentidos: > maxVolumeRatio (spike) e < 1/maxVolumeRatio (queda).
   */
  maxVolumeRatio: number;
}

export const DELTA_GATE_DEFAULTS: DeltaGateOptions = {
  maxReuse: 2,
  maxAgeMs: 5 * 60_000,
  minJaccard: 0.5,
  maxSentDelta: 0.3,
  maxVolumeRatio: 2.5,
};

/** Similaridade de Jaccard entre dois conjuntos de tokens. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Distribuição normalizada do tally heurístico da janela. Sem hints
 * (janela toda sem sinal) → 100% neutro, que é o comportamento conservador.
 */
export function sentimentDistribution(agg: BatchAggregate): {
  pos: number;
  neg: number;
  neu: number;
} {
  const sw = agg.sentimentWeighted;
  const total = sw ? sw.pos + sw.neg + sw.neu : 0;
  if (!sw || total === 0) return { pos: 0, neg: 0, neu: 1 };
  return { pos: sw.pos / total, neg: sw.neg / total, neu: sw.neu / total };
}

/** True quando a janela atual pode reaproveitar o snapshot sem chamar o LLM. */
export function shouldReuseTier2(
  agg: BatchAggregate,
  snap: Tier2Snapshot | undefined,
  now: number,
  opts: DeltaGateOptions = DELTA_GATE_DEFAULTS,
): boolean {
  if (!snap) return false;
  if (now - snap.at > opts.maxAgeMs) return false;
  if (snap.reuseCount >= opts.maxReuse) return false;
  if (snap.tier2.llmTier !== 2) return false;
  if (snap.tier2.needsEscalation) return false;
  if (agg.adActive !== snap.adActive) return false;

  // Volume: veta nos dois sentidos. Só o spike era vetado antes, então uma
  // janela que despencou (raid acabou, stream esvaziou) reaproveitava a pauta
  // de um chat que não existe mais — a queda é tão informativa quanto o pico.
  const volRatio =
    snap.totalMsgsWeighted > 0
      ? agg.totalMsgsWeighted / snap.totalMsgsWeighted
      : Number.POSITIVE_INFINITY;
  if (volRatio > opts.maxVolumeRatio) return false;
  if (volRatio < 1 / opts.maxVolumeRatio) return false;

  if (jaccard(new Set(agg.topTokens), snap.topTokens) < opts.minJaccard) return false;

  const cur = sentimentDistribution(agg);
  const prev = snap.sentDist;
  const l1 =
    Math.abs(cur.pos - prev.pos) + Math.abs(cur.neg - prev.neg) + Math.abs(cur.neu - prev.neu);
  if (l1 > opts.maxSentDelta) return false;

  return true;
}

/**
 * Monta o Tier2Output do reuso: `base` (fallback heurístico da janela ATUAL —
 * sentimento, tóxicos, marcas e ad frescos) + campos semânticos do snapshot
 * (categorias com counts reescalados pro volume atual + contexto da pauta).
 */
export function reuseTier2(
  base: Tier2Output,
  snap: Tier2Snapshot,
  agg: BatchAggregate,
): Tier2Output {
  const scale = snap.totalMsgsWeighted > 0 ? agg.totalMsgsWeighted / snap.totalMsgsWeighted : 1;
  const topCategories = snap.tier2.topCategories.map((c) => ({
    category: c.category,
    count: Math.max(1, Math.round(c.count * scale)),
  }));
  return {
    ...base,
    topCategories: topCategories.length ? topCategories : base.topCategories,
    dominantCategoryContext: snap.tier2.dominantCategoryContext || base.dominantCategoryContext,
    // Confiança decai a cada reuso — nunca acima da original.
    confidence: Math.max(0.3, snap.tier2.confidence * 0.9),
    reasoning: 'janela similar à anterior: análise semântica reaproveitada (delta-gate)',
    llmTier: 1,
    llmModel: `${snap.tier2.llmModel}+reuso`,
    llmCostUsd: 0,
    llmLatencyMs: 0,
    llmCacheHitRate: 0,
  };
}

/** Snapshot para a memória do canal a partir da janela + tier-2 recém-obtido. */
export function makeTier2Snapshot(agg: BatchAggregate, tier2: Tier2Output): Tier2Snapshot {
  return {
    at: Date.now(),
    topTokens: new Set(agg.topTokens),
    sentDist: sentimentDistribution(agg),
    totalMsgsWeighted: agg.totalMsgsWeighted,
    adActive: agg.adActive,
    tier2,
    reuseCount: 0,
  };
}
