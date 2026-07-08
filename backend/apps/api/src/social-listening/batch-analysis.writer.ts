import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseClient } from '@sehloro/infra';
import type { BatchAnalysis } from './batch-analysis.types';

@Injectable()
export class BatchAnalysisWriter {
  private readonly logger = new Logger(BatchAnalysisWriter.name);
  constructor(private readonly ch: ClickHouseClient) {}

  async write(b: BatchAnalysis): Promise<void> {
    const row = {
      channel_id: b.channelId,
      session_id: b.sessionId,
      batch_id: b.batchId,
      window_start: _dt(b.windowStart),
      window_end: _dt(b.windowEnd),
      message_count: b.messageCount,
      message_count_weighted: b.messageCountWeighted,
      unique_users: b.uniqueUsers,
      is_subscriber_ratio: b.isSubscriberRatio,
      sentiment_pos: Math.round((b.climaGeral.pos ?? 0) * 1000),
      sentiment_neu: Math.round((b.climaGeral.neu ?? 0) * 1000),
      sentiment_neg: Math.round((b.climaGeral.neg ?? 0) * 1000),
      top_categories_json: JSON.stringify(
        // recupera do BatchAnalysis o que conseguimos (pauta mais/menos)
        [b.pautaMaisComentada, b.pautaMenosComentada].filter(Boolean),
      ),
      dominant_category: b.pautaMaisComentada?.category ?? 'other',
      least_category: b.pautaMenosComentada?.category ?? '',
      least_category_count: b.pautaMenosComentada?.count ?? 0,
      top_toxic_users_json: JSON.stringify(b.userMaisToxico ? [b.userMaisToxico] : []),
      most_toxic_username: b.userMaisToxico?.username ?? '',
      most_toxic_ratio: b.userMaisToxico?.ratio ?? 0,
      most_toxic_msg_count: b.userMaisToxico?.msgCount ?? 0,
      least_toxic_username: b.userMenosToxico?.username ?? '',
      least_toxic_ratio: b.userMenosToxico?.ratio ?? 0,
      least_toxic_msg_count: b.userMenosToxico?.msgCount ?? 0,
      ad_active: b.sentimentoAd?.active ? 1 : 0,
      ad_source: b.sentimentoAd?.source ?? '',
      ad_sentiment_pos: b.sentimentoAd?.pos ?? 0,
      ad_sentiment_neu: b.sentimentoAd?.neu ?? 0,
      ad_sentiment_neg: b.sentimentoAd?.neg ?? 0,
      ad_sample_size: b.sentimentoAd?.sampleSize ?? 0,
      mentioned_brands_json: JSON.stringify(b.marcasMencionadas),
      top_tokens: b.topTokens,
      llm_tier: b.llmTier,
      llm_model: b.llmModel,
      llm_cost_usd: b.llmCostUsd,
      llm_latency_ms: b.llmLatencyMs,
      llm_cache_hit_rate: b.llmCacheHitRate,
      llm_confidence: b.llmConfidence,
      insight_text: b.insightText,
    };
    try {
      await this.ch.insert('batch_analysis', [row]);
    } catch (err) {
      this.logger.error(`Falha ao gravar batch_analysis: ${(err as Error).message}`);
    }
  }
}

function _dt(d: Date): string {
  // ClickHouse aceita 'YYYY-MM-DD HH:mm:ss.SSS' para DateTime64(3)
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
