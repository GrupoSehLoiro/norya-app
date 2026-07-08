/**
 * MetricsService — agregadores sobre `batch_analysis` (ClickHouse).
 *
 * Endpoint mostra ao operador:
 *   - custo total (USD) e por tier/modelo/canal
 *   - distribuição de tier (mock/real/fallback)
 *   - latência p50/p95 do LLM
 *   - cache hit rate médio (só tier-2)
 *   - confidence médio
 *   - série temporal (hour por default) p/ gráfico
 *
 * Filtros: janela de tempo (`from`, `to`) — default últimas 24h.
 * Sem agregações em Mongo — tudo em CH (já indexado por window_start).
 */
import { Injectable } from '@nestjs/common';
import { ClickHouseClient } from '@sehloro/infra';

export type Granularity = 'minute' | 'hour' | 'day';

export interface MetricsRange {
  from: string;
  to: string;
  granularity: Granularity;
}

export interface MetricsTotals {
  batches: number;
  messages: number;
  messagesWeighted: number;
  uniqueUsersSum: number;
  costUsd: number;
  activeChannels: number;
}

export interface MetricsByTier {
  tier: number;
  count: number;
  costUsd: number;
}
export interface MetricsByModel {
  model: string;
  count: number;
  costUsd: number;
  avgLatencyMs: number;
}
export interface MetricsByChannel {
  channelId: string;
  batches: number;
  messages: number;
  costUsd: number;
}
export interface MetricsLatency {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
}
export interface MetricsTimeseriesPoint {
  bucket: string;
  batches: number;
  messages: number;
  costUsd: number;
  avgLatencyMs: number;
  avgConfidence: number;
}

export interface MetricsSummary {
  range: MetricsRange;
  totals: MetricsTotals;
  byTier: MetricsByTier[];
  byModel: MetricsByModel[];
  byChannel: MetricsByChannel[];
  latency: MetricsLatency;
  cacheHitRateAvg: number;
  confidenceAvg: number;
  timeseries: MetricsTimeseriesPoint[];
}

const GRANULARITY_FN: Record<Granularity, string> = {
  minute: 'toStartOfMinute',
  hour: 'toStartOfHour',
  day: 'toStartOfDay',
};

@Injectable()
export class MetricsService {
  constructor(private readonly ch: ClickHouseClient) {}

  async summary(args: {
    from?: Date;
    to?: Date;
    granularity?: Granularity;
    channelId?: string;
  }): Promise<MetricsSummary> {
    const to = args.to ?? new Date();
    const from = args.from ?? new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const granularity: Granularity = args.granularity ?? 'hour';
    const params = {
      from: _dt(from),
      to: _dt(to),
      ...(args.channelId ? { channel: args.channelId } : {}),
    };
    const channelClause = args.channelId ? 'AND channel_id = {channel: String}' : '';

    const totals = (
      await this.ch.query<{
        batches: string;
        messages: string;
        messages_weighted: string;
        unique_users_sum: string;
        cost_usd: string;
        active_channels: string;
      }>(
        `SELECT
           count() AS batches,
           sum(message_count) AS messages,
           sum(message_count_weighted) AS messages_weighted,
           sum(unique_users) AS unique_users_sum,
           sum(toFloat64(llm_cost_usd)) AS cost_usd,
           uniq(channel_id) AS active_channels
         FROM batch_analysis
         WHERE window_start >= {from: DateTime64(3)}
           AND window_start <= {to: DateTime64(3)}
           ${channelClause}`,
        params,
      )
    )[0];

    const byTier = (
      await this.ch.query<{
        tier: number;
        count: string;
        cost_usd: string;
      }>(
        `SELECT llm_tier AS tier, count() AS count, sum(toFloat64(llm_cost_usd)) AS cost_usd
       FROM batch_analysis
       WHERE window_start >= {from: DateTime64(3)}
         AND window_start <= {to: DateTime64(3)}
         ${channelClause}
       GROUP BY tier ORDER BY tier`,
        params,
      )
    ).map((r) => ({
      tier: Number(r.tier),
      count: Number(r.count),
      costUsd: Number(r.cost_usd),
    }));

    const byModel = (
      await this.ch.query<{
        model: string;
        count: string;
        cost_usd: string;
        avg_latency: string;
      }>(
        `SELECT llm_model AS model, count() AS count,
              sum(toFloat64(llm_cost_usd)) AS cost_usd,
              avg(llm_latency_ms) AS avg_latency
       FROM batch_analysis
       WHERE window_start >= {from: DateTime64(3)}
         AND window_start <= {to: DateTime64(3)}
         ${channelClause}
       GROUP BY model ORDER BY count DESC`,
        params,
      )
    ).map((r) => ({
      model: r.model || '—',
      count: Number(r.count),
      costUsd: Number(r.cost_usd),
      avgLatencyMs: Number(r.avg_latency ?? 0),
    }));

    const byChannel = (
      await this.ch.query<{
        channel_id: string;
        batches: string;
        messages: string;
        cost_usd: string;
      }>(
        `SELECT channel_id, count() AS batches,
              sum(message_count) AS messages,
              sum(toFloat64(llm_cost_usd)) AS cost_usd
       FROM batch_analysis
       WHERE window_start >= {from: DateTime64(3)}
         AND window_start <= {to: DateTime64(3)}
         ${channelClause}
       GROUP BY channel_id ORDER BY cost_usd DESC, batches DESC LIMIT 15`,
        params,
      )
    ).map((r) => ({
      channelId: r.channel_id,
      batches: Number(r.batches),
      messages: Number(r.messages),
      costUsd: Number(r.cost_usd),
    }));

    const latencyRow = (
      await this.ch.query<{ p50: string; p95: string; p99: string; avg_ms: string }>(
        `SELECT quantile(0.5)(llm_latency_ms) AS p50,
                quantile(0.95)(llm_latency_ms) AS p95,
                quantile(0.99)(llm_latency_ms) AS p99,
                avg(llm_latency_ms) AS avg_ms
         FROM batch_analysis
         WHERE window_start >= {from: DateTime64(3)}
           AND window_start <= {to: DateTime64(3)}
           ${channelClause}`,
        params,
      )
    )[0];

    const cacheRow = (
      await this.ch.query<{ avg_cache: string }>(
        `SELECT avg(llm_cache_hit_rate) AS avg_cache
         FROM batch_analysis
         WHERE window_start >= {from: DateTime64(3)}
           AND window_start <= {to: DateTime64(3)}
           AND llm_tier = 2
           ${channelClause}`,
        params,
      )
    )[0];

    const confRow = (
      await this.ch.query<{ avg_conf: string }>(
        `SELECT avg(llm_confidence) AS avg_conf
         FROM batch_analysis
         WHERE window_start >= {from: DateTime64(3)}
           AND window_start <= {to: DateTime64(3)}
           ${channelClause}`,
        params,
      )
    )[0];

    const timeseries = (
      await this.ch.query<{
        bucket: string;
        batches: string;
        messages: string;
        cost_usd: string;
        avg_latency: string;
        avg_conf: string;
      }>(
        `SELECT ${GRANULARITY_FN[granularity]}(window_start) AS bucket,
                count() AS batches,
                sum(message_count) AS messages,
                sum(toFloat64(llm_cost_usd)) AS cost_usd,
                avg(llm_latency_ms) AS avg_latency,
                avg(llm_confidence) AS avg_conf
         FROM batch_analysis
         WHERE window_start >= {from: DateTime64(3)}
           AND window_start <= {to: DateTime64(3)}
           ${channelClause}
         GROUP BY bucket ORDER BY bucket`,
        params,
      )
    ).map((r) => ({
      bucket: r.bucket,
      batches: Number(r.batches),
      messages: Number(r.messages),
      costUsd: Number(r.cost_usd),
      avgLatencyMs: Number(r.avg_latency ?? 0),
      avgConfidence: Number(r.avg_conf ?? 0),
    }));

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
      },
      totals: {
        batches: Number(totals?.batches ?? 0),
        messages: Number(totals?.messages ?? 0),
        messagesWeighted: Number(totals?.messages_weighted ?? 0),
        uniqueUsersSum: Number(totals?.unique_users_sum ?? 0),
        costUsd: Number(totals?.cost_usd ?? 0),
        activeChannels: Number(totals?.active_channels ?? 0),
      },
      byTier,
      byModel,
      byChannel,
      latency: {
        p50Ms: Number(latencyRow?.p50 ?? 0),
        p95Ms: Number(latencyRow?.p95 ?? 0),
        p99Ms: Number(latencyRow?.p99 ?? 0),
        avgMs: Number(latencyRow?.avg_ms ?? 0),
      },
      cacheHitRateAvg: Number(cacheRow?.avg_cache ?? 0),
      confidenceAvg: Number(confRow?.avg_conf ?? 0),
      timeseries,
    };
  }
}

function _dt(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
