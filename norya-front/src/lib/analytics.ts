/**
 * Cliente dos endpoints de analytics (busca de mensagens, AD summary, marcas).
 * Tipos espelhados do backend (social-listening).
 */
import { api } from './api-client';

export interface MessageHit {
  messageId: string;
  username: string;
  text: string;
  isMod: boolean;
  isSubscriber: boolean;
  sentiment: string;
  receivedAt: string;
}
export interface MessageSearchResult {
  channelId: string;
  query: string;
  total: number;
  organic: number;
  fromMods: number;
  items: MessageHit[];
}

export interface AdSummary {
  channelId: string;
  totalAds: number;
  totalSeconds: number;
  avgSeconds: number;
  perHour: { bucket: string; ads: number; seconds: number }[];
}

export interface BrandAnalytics {
  channelId: string;
  totals: { brand: string; count: number }[];
  timeline: { day: string; brand: string; count: number }[];
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  return p.toString();
}

export const searchMessages = (
  channelId: string,
  q: string,
  from?: string,
  to?: string,
) =>
  api.get<MessageSearchResult>(
    `/api/v2/social-listening/messages/search?${qs({ channelId, q, from, to })}`,
  );

export const fetchAdSummary = (channelId: string, from?: string, to?: string) =>
  api.get<AdSummary>(
    `/api/v2/social-listening/ad/summary?${qs({ channelId, from, to })}`,
  );

export const fetchBrandAnalytics = (channelId: string, from?: string, to?: string) =>
  api.get<BrandAnalytics>(
    `/api/v2/social-listening/brands/analytics?${qs({ channelId, from, to })}`,
  );

export interface ChatTopics {
  channelId: string;
  messageCount: number;
  topTokens: { token: string; count: number }[];
  topCategories: { category: string; messages: number }[];
  labels: string[];
  summary: string;
  aiEnabled: boolean;
}

export const fetchChatTopics = (channelId: string, from?: string, to?: string) =>
  api.get<ChatTopics>(
    `/api/v2/social-listening/insights/topics?${qs({ channelId, from, to })}`,
  );

export interface TopicBucket {
  bucket: string;
  messageCount: number;
  dominantCategory: string;
  labels: string[];
}
export const fetchChatTopicsHistory = (channelId: string, from?: string, to?: string) =>
  api.get<TopicBucket[]>(
    `/api/v2/social-listening/insights/topics/history?${qs({ channelId, from, to })}`,
  );

export interface InsightsSummary {
  channelId: string;
  totalMessages: number;
  activeDays: number;
  peakUsers: number;
  windows: number;
  peak: { at: string; messages: number } | null;
  topKeywords: { word: string; count: number }[];
}
export const fetchInsightsSummary = (channelId: string, from?: string, to?: string) =>
  api.get<InsightsSummary>(
    `/api/v2/social-listening/insights/summary?${qs({ channelId, from, to })}`,
  );

export interface WindowInsight {
  channelId: string;
  q: string;
  total: number;
  insight: string;
  aiEnabled: boolean;
  sample: MessageHit[];
}
export const fetchWindowInsight = (
  channelId: string,
  opts: { from?: string; to?: string; q?: string },
) =>
  api.get<WindowInsight>(
    `/api/v2/social-listening/insights/window-insight?${qs({ channelId, ...opts })}`,
  );

export interface BatchInsight {
  batchId: string;
  channelId: string;
  messageCount: number;
  insight: string;
  aiEnabled: boolean;
}
export const fetchBatchInsight = (batchId: string) =>
  api.get<BatchInsight>(
    `/api/v2/social-listening/batches/${encodeURIComponent(batchId)}/insight`,
  );
