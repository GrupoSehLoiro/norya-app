import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseClient } from '@sehloro/infra';
import type { BatchAnalysis } from './batch-analysis.types';

interface ChRow {
  batch_id: string;
  channel_id: string;
  session_id: string | null;
  window_start: string;
  window_end: string;
  message_count: number;
  message_count_weighted: number;
  unique_users: number;
  is_subscriber_ratio: number;
  sentiment_pos: number;
  sentiment_neu: number;
  sentiment_neg: number;
  dominant_category: string;
  top_categories_json: string;
  least_category: string;
  least_category_count: number;
  most_toxic_username: string;
  most_toxic_ratio: number;
  most_toxic_msg_count: number;
  least_toxic_username: string;
  least_toxic_ratio: number;
  least_toxic_msg_count: number;
  ad_active: number;
  ad_source: string;
  ad_sentiment_pos: number;
  ad_sentiment_neu: number;
  ad_sentiment_neg: number;
  ad_sample_size: number;
  mentioned_brands_json: string;
  top_tokens: string[];
  llm_tier: number;
  llm_model: string;
  llm_cost_usd: string | number;
  llm_latency_ms: number;
  llm_cache_hit_rate: number;
  llm_confidence: number;
  insight_text: string;
  created_at: string;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  constructor(private readonly ch: ClickHouseClient) {}

  /**
   * Último batch COM conteúdo do canal. Janelas minúsculas (1 msg, ou tudo
   * removido como copypasta) geram sentimento 0/0/0 e categoria 'other'; se
   * o card do console mostrasse esse batch cru, "Clima geral" piscava pra
   * "neutro 0%" e "Pauta" pra "—" a cada rajada curta, mesmo com a live cheia.
   * Por isso priorizamos o batch mais recente com mensagens e sentimento
   * preenchidos; só caímos no último bruto se o canal não tiver nenhum assim.
   */
  async latest(channelId: string): Promise<BatchAnalysis | null> {
    const meaningful = await this._select(
      `SELECT * FROM batch_analysis
       WHERE channel_id = {ch: String}
         AND message_count > 0
         AND (sentiment_pos + sentiment_neu + sentiment_neg) > 0
       ORDER BY window_start DESC
       LIMIT 1`,
      { ch: channelId },
    );
    if (meaningful[0]) return this._withRecentPauta(channelId, meaningful[0]);
    const rows = await this._select(
      `SELECT * FROM batch_analysis
       WHERE channel_id = {ch: String}
       ORDER BY window_start DESC
       LIMIT 1`,
      { ch: channelId },
    );
    return rows[0] ?? null;
  }

  /**
   * Janelas tier 0 (menos de 8 msgs, sem LLM) raramente têm categoria: a
   * heurística por palavras-chave sai vazia e o batch grava 'other'. Pra o
   * card "Pauta mais comentada" não alternar entre texto e "—" a cada rajada,
   * herdamos a pauta do batch mais recente COM categoria nos últimos 15 min.
   * Clima, contagens e demais campos continuam sendo os do batch base.
   */
  private async _withRecentPauta(channelId: string, base: BatchAnalysis): Promise<BatchAnalysis> {
    if (base.pautaMaisComentada) return base;
    const rows = await this._select(
      `SELECT * FROM batch_analysis
       WHERE channel_id = {ch: String}
         AND dominant_category != ''
         AND dominant_category != 'other'
         AND window_start > now() - INTERVAL 15 MINUTE
       ORDER BY window_start DESC
       LIMIT 1`,
      { ch: channelId },
    );
    const donor = rows[0];
    if (!donor?.pautaMaisComentada) return base;
    return { ...base, pautaMaisComentada: donor.pautaMaisComentada };
  }

  async history(channelId: string, from?: Date, to?: Date, limit = 200): Promise<BatchAnalysis[]> {
    const where = ['channel_id = {ch: String}'];
    const params: Record<string, unknown> = { ch: channelId, lim: Math.min(limit, 500) };
    if (from) {
      where.push('window_start >= {from: DateTime64(3)}');
      params.from = _dt(from);
    }
    if (to) {
      where.push('window_start <= {to:   DateTime64(3)}');
      params.to = _dt(to);
    }
    return this._select(
      `SELECT * FROM batch_analysis
       WHERE ${where.join(' AND ')}
       ORDER BY window_start DESC
       LIMIT {lim: UInt32}`,
      params,
    );
  }

  private async _select(query: string, params: Record<string, unknown>): Promise<BatchAnalysis[]> {
    const rows = await this.ch.query<ChRow>(query, params);
    return rows.map((r) => this._toAnalysis(r));
  }

  /**
   * Recupera a primeira categoria do `top_categories_json` (== pauta mais
   * comentada, conforme o writer serializa) pra resgatar count + context da IA.
   */
  private _dominantFromJson(
    json: string,
  ): { category?: string; count?: number; context?: string } | null {
    try {
      const arr = JSON.parse(json || '[]');
      return Array.isArray(arr) && arr[0] ? arr[0] : null;
    } catch {
      return null;
    }
  }

  private _toAnalysis(r: ChRow): BatchAnalysis {
    let brands: BatchAnalysis['marcasMencionadas'] = [];
    try {
      brands = JSON.parse(r.mentioned_brands_json || '[]');
    } catch {
      brands = [];
    }

    return {
      batchId: r.batch_id,
      channelId: r.channel_id,
      sessionId: r.session_id,
      windowStart: _utc(r.window_start),
      windowEnd: _utc(r.window_end),
      messageCount: Number(r.message_count),
      messageCountWeighted: Number(r.message_count_weighted),
      uniqueUsers: Number(r.unique_users),
      isSubscriberRatio: Number(r.is_subscriber_ratio),
      topTokens: r.top_tokens ?? [],
      climaGeral: {
        pos: Number(r.sentiment_pos) / 1000,
        neg: Number(r.sentiment_neg) / 1000,
        neu: Number(r.sentiment_neu) / 1000,
      },
      pautaMaisComentada:
        r.dominant_category && r.dominant_category !== 'other'
          ? {
              category: r.dominant_category,
              count: this._dominantFromJson(r.top_categories_json)?.count ?? 0,
              context: this._dominantFromJson(r.top_categories_json)?.context || undefined,
            }
          : null,
      pautaMenosComentada: r.least_category
        ? { category: r.least_category, count: Number(r.least_category_count) }
        : null,
      userMaisToxico: r.most_toxic_username
        ? {
            username: r.most_toxic_username,
            ratio: Number(r.most_toxic_ratio),
            msgCount: Number(r.most_toxic_msg_count),
            negCount: Math.round(Number(r.most_toxic_ratio) * Number(r.most_toxic_msg_count)),
          }
        : null,
      userMenosToxico: r.least_toxic_username
        ? {
            username: r.least_toxic_username,
            ratio: Number(r.least_toxic_ratio),
            msgCount: Number(r.least_toxic_msg_count),
            posCount: Math.round(Number(r.least_toxic_ratio) * Number(r.least_toxic_msg_count)),
          }
        : null,
      sentimentoAd:
        r.ad_active === 1
          ? {
              active: true,
              source: (r.ad_source as 'twitch' | 'manual') || null,
              pos: Number(r.ad_sentiment_pos),
              neg: Number(r.ad_sentiment_neg),
              neu: Number(r.ad_sentiment_neu),
              sampleSize: Number(r.ad_sample_size),
            }
          : null,
      marcasMencionadas: brands,
      llmTier: Number(r.llm_tier) as 0 | 1 | 2 | 3,
      llmModel: r.llm_model,
      llmCostUsd: Number(r.llm_cost_usd ?? 0),
      llmLatencyMs: Number(r.llm_latency_ms),
      llmCacheHitRate: Number(r.llm_cache_hit_rate),
      llmConfidence: Number(r.llm_confidence),
      needsEscalation: false,
      insightText: r.insight_text ?? '',
      createdAt: _utc(r.created_at),
    };
  }
}

/**
 * ClickHouse devolve DateTime64 como 'YYYY-MM-DD HH:mm:ss.SSS' SEM sufixo de
 * fuso, mas o valor É UTC. `new Date(...)` interpretaria como hora local do
 * processo — correto só por acidente quando TZ=UTC (Docker). Normaliza
 * explicitamente para o parse ser independente do TZ do host.
 */
function _utc(s: string): Date {
  if (/z$|[+-]\d\d:?\d\d$/i.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

function _dt(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
