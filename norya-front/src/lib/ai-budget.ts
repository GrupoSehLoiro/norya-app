/**
 * Cliente do painel admin de custo de IA (/api/v2/admin/llm-budget).
 * Tetos por canal com herança: override do canal → global → env → default.
 */
import { api } from './api-client';

export interface EffectiveBudget {
  monthlyTokens: number;
  tokensPerMinute: number;
  paused: boolean;
  source: 'channel' | 'global' | 'env' | 'default';
}

export interface ChannelBudgetRow {
  channelId: string;
  name: string;
  effective: EffectiveBudget;
  override: { monthlyTokens?: number; tokensPerMinute?: number; paused: boolean } | null;
  usedMonthlyTokens: number | null;
  costUsdMonth: number | null;
  status: 'ok' | 'paused' | 'blocked_monthly';
}

export interface BudgetOverview {
  defaults: {
    global: {
      monthlyTokens?: number;
      tokensPerMinute?: number;
      paused: boolean;
      updatedBy?: string;
    } | null;
    env: { monthlyTokens?: number; tokensPerMinute?: number };
    hardDefaults: { monthlyTokens: number; tokensPerMinute: number };
  };
  channels: ChannelBudgetRow[];
  redisAvailable: boolean;
}

export interface BudgetPatch {
  monthlyTokens?: number;
  tokensPerMinute?: number;
  paused?: boolean;
}

export const fetchBudgetOverview = () => api.get<BudgetOverview>('/api/v2/admin/llm-budget');

export const patchBudgetDefaults = (patch: BudgetPatch) =>
  api.patch('/api/v2/admin/llm-budget/defaults', patch);

export const putChannelBudget = (channelId: string, patch: BudgetPatch) =>
  api.put(`/api/v2/admin/llm-budget/channels/${encodeURIComponent(channelId)}`, patch);

export const deleteChannelBudget = (channelId: string) =>
  api.delete(`/api/v2/admin/llm-budget/channels/${encodeURIComponent(channelId)}`);

export const resetChannelMonth = (channelId: string) =>
  api.post(`/api/v2/admin/llm-budget/channels/${encodeURIComponent(channelId)}/reset-month`);

/** 12_345_678 → "12,3M"; 20_000 → "20k". */
export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}
