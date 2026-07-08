/**
 * Payload final que sai do orchestrator. Mesma shape do que vai pro
 * ClickHouse (batch_analysis) E pelo SSE (analysis:<channelId>).
 *
 * Os 7 insights são extraídos diretamente desta struct pelo controller
 * REST e pelo SSE consumer.
 */
import type { Tier2Output, BrandHit } from '@sehloro/domain';

export interface BatchAnalysis {
  batchId: string;
  channelId: string;
  sessionId: string | null;
  windowStart: Date;
  windowEnd: Date;
  messageCount: number;
  messageCountWeighted: number;
  uniqueUsers: number;
  isSubscriberRatio: number;
  topTokens: string[];

  // 7 insights
  climaGeral: Tier2Output['sentiment'];
  pautaMaisComentada: { category: string; count: number; context?: string } | null;
  pautaMenosComentada: { category: string; count: number } | null;
  userMaisToxico: Tier2Output['topToxicUsers'][number] | null;
  userMenosToxico: Tier2Output['leastToxicUser'];
  sentimentoAd: Tier2Output['adSentiment'];
  marcasMencionadas: BrandHit[];

  // telemetria LLM
  llmTier: 0 | 1 | 2 | 3;
  llmModel: string;
  llmCostUsd: number;
  llmLatencyMs: number;
  llmCacheHitRate: number;
  llmConfidence: number;
  needsEscalation: boolean;
  insightText: string;

  createdAt: Date;
}

/** Coloca o Tier2Output dentro do BatchAnalysis. */
export function composeBatchAnalysis(args: {
  batchId: string;
  channelId: string;
  sessionId: string | null;
  windowStart: Date;
  windowEnd: Date;
  totalMsgs: number;
  totalMsgsWeighted: number;
  uniqueUsers: number;
  isSubscriberRatio: number;
  topTokens: string[];
  tier2: Tier2Output;
}): BatchAnalysis {
  const t = args.tier2;
  const top = t.topCategories[0] ?? null;
  // "Pauta menos comentada" = última categoria com count>0
  const positivos = t.topCategories.filter((c) => c.count > 0);
  const bottom = positivos.length > 1 ? positivos[positivos.length - 1]! : null;
  return {
    batchId: args.batchId,
    channelId: args.channelId,
    sessionId: args.sessionId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    messageCount: args.totalMsgs,
    messageCountWeighted: args.totalMsgsWeighted,
    uniqueUsers: args.uniqueUsers,
    isSubscriberRatio: args.isSubscriberRatio,
    topTokens: args.topTokens,
    climaGeral: t.sentiment,
    pautaMaisComentada: top ? { ...top, context: t.dominantCategoryContext || undefined } : null,
    pautaMenosComentada: bottom,
    userMaisToxico: t.topToxicUsers[0] ?? null,
    userMenosToxico: t.leastToxicUser,
    sentimentoAd: t.adSentiment,
    marcasMencionadas: t.mentionedBrands,
    llmTier: t.llmTier,
    llmModel: t.llmModel,
    llmCostUsd: t.llmCostUsd,
    llmLatencyMs: t.llmLatencyMs,
    llmCacheHitRate: t.llmCacheHitRate,
    llmConfidence: t.confidence,
    needsEscalation: t.needsEscalation,
    insightText: t.reasoning ?? '',
    createdAt: new Date(),
  };
}
