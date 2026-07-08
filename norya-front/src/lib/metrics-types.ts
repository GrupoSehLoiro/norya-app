/** Espelho do shape devolvido por `GET /api/v2/social-listening/metrics/summary`. */
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

export interface MetricsByTier { tier: number; count: number; costUsd: number }
export interface MetricsByModel { model: string; count: number; costUsd: number; avgLatencyMs: number }
export interface MetricsByChannel { channelId: string; batches: number; messages: number; costUsd: number }
export interface MetricsLatency { p50Ms: number; p95Ms: number; p99Ms: number; avgMs: number }
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
