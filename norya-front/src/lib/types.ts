/**
 * Tipos espelhados do backend SEHLORO (M4 IA core).
 * Mantidos manualmente — a interface HTTP é o contrato.
 */

export type WsRole = 'owner' | 'admin' | 'manager' | 'analyst' | 'viewer';

export interface JwtUser {
  /** Backend (Nest) emits `sub` in the JWT, not `userId`. Both kept for back-compat. */
  sub?: string;
  userId?: string;
  username: string;
  email: string;
  role: 'admin' | 'mod' | 'user' | string;
  /** Tenancy claims (Fase 1) — ausentes em tokens legados. */
  activeWorkspaceId?: string;
  wsRole?: WsRole;
  iat: number;
  exp: number;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    displayName?: string | null;
  };
  activeWorkspaceId?: string | null;
  wsRole?: WsRole | null;
}

export interface RegisterResponse {
  status: 'pending_email';
  email: string;
}

export interface AuthTokensLite {
  accessToken: string;
  refreshToken: string;
}

export interface MeResponse {
  user: {
    id: string;
    username: string;
    email: string;
    role: string;
    displayName: string | null;
    avatarUrl: string | null;
    locale: string | null;
    status: string;
    emailVerified: boolean;
    onboardingCompleted: boolean;
  };
  activeWorkspaceId: string | null;
  wsRole: WsRole | null;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    type: string;
    planKey: string;
    role: WsRole;
  }>;
}

// ── v2/channels ──────────────────────────────────────────────────────────────

export type ChannelPlatform = 'twitch' | 'kick';

/**
 * Shape REAL devolvido pelo backend (`GET /api/v2/channels`):
 *   { channels: [ { id, name, platform, flags, active, createdAt } ], total }
 *
 * As funções queryFn no console desempacotam `.channels` antes de entregar.
 */
export interface ChannelV2 {
  id: string;
  name: string;
  platform: ChannelPlatform;
  flags?: Record<string, unknown>;
  active?: boolean;
  externalId?: string | null;
  ownerId?: string | null;
  creatorId?: string | null;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChannelsListResponse {
  channels: ChannelV2[];
  total: number;
}

// ── v2/monitoring/sessions ───────────────────────────────────────────────────

export interface LiveSession {
  id: string;
  channelId: string;
  /** Backend (Nest) emite `state: 'ACTIVE'|'ENDED'|'STALE'` (uppercase). */
  state: 'ACTIVE' | 'ENDED' | 'STALE' | string;
  startedAt: string;
  endedAt?: string | null;
  platform?: string;
  totalMessages?: number;
  autoStarted?: boolean;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionsListResponse {
  sessions: LiveSession[];
  total: number;
}

// ── v2/feature-flags ─────────────────────────────────────────────────────────

export type FlagRuleType = 'channel' | 'user' | 'percentage';

export interface FlagRule {
  type: FlagRuleType;
  ids?: string[];
  percentage?: number;
  value: boolean;
}

export interface FeatureFlag {
  _id?: string;
  key: string;
  description?: string;
  defaultValue: boolean;
  rules?: FlagRule[];
  updatedAt?: string;
  updatedBy?: string;
}

// ── v2/social-listening/ad ───────────────────────────────────────────────────

export type AdSegmentSource = 'twitch' | 'manual';

export interface AdSegment {
  id: string;
  channelId: string;
  sessionId: string | null;
  source: AdSegmentSource;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  isAutomatic: boolean;
}

export interface AdStatus {
  active: boolean;
  source: AdSegmentSource | null;
  segment: AdSegment | null;
}

// ── v2/social-listening/brands ───────────────────────────────────────────────

export interface ChannelBrand {
  id: string;
  channelId: string;
  name: string;
  aliases: string[];
  regex: string | null;
  createdAt: string;
}

// ── v2/social-listening/insights ─────────────────────────────────────────────

export interface BrandHit {
  brand: string;
  count: number;
  sample: string[];
}

export interface BatchAnalysis {
  batchId: string;
  channelId: string;
  sessionId: string | null;
  windowStart: string; // ISO date
  windowEnd: string;
  messageCount: number;
  messageCountWeighted: number;
  uniqueUsers: number;
  isSubscriberRatio: number;
  topTokens: string[];

  climaGeral: { pos: number; neg: number; neu: number };
  pautaMaisComentada: { category: string; count: number; context?: string } | null;
  pautaMenosComentada: { category: string; count: number } | null;
  userMaisToxico: { username: string; ratio: number; msgCount: number; negCount: number } | null;
  userMenosToxico: { username: string; ratio: number; msgCount: number; posCount: number } | null;
  sentimentoAd: {
    active: boolean;
    source: AdSegmentSource | null;
    pos: number;
    neg: number;
    neu: number;
    sampleSize: number;
  } | null;
  marcasMencionadas: BrandHit[];

  llmTier: 0 | 1 | 2 | 3;
  llmModel: string;
  llmCostUsd: number;
  llmLatencyMs: number;
  llmCacheHitRate: number;
  llmConfidence: number;
  needsEscalation?: boolean;
  insightText: string;
  createdAt?: string;
}

export interface InsightsLatestResponse {
  channelId: string;
  analysis: BatchAnalysis | null;
}

export interface InsightsHistoryResponse {
  channelId: string;
  items: BatchAnalysis[];
}

// ── SSE payload mistura BatchAnalysis e heartbeat ────────────────────────────

export type SseInsightMessage = BatchAnalysis | { ping: number };
