/**
 * Tipos espelhados dos endpoints `/api/v2/legacy/*`.
 *
 * Backend: backend/apps/api/src/legacy/<feature>/<feature>.service.ts.
 * O contrato é o JSON HTTP — atualize aqui se um campo mudar lá.
 */

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CountByChannelRow {
  channel: string;
  count: number;
}

export interface BanRow {
  id: string;
  channel: string | null;
  userName: string;
  reason: string;
  modName: string;
  timestamp: string;
}

export interface TimeoutRow {
  id: string;
  channel: string;
  userName: string;
  reason: string;
  tempoDeTO: number;
  modName: string;
  timestamp: string;
}

export interface RemovedRow {
  id: string;
  channel: string;
  username: string;
  deletedMessage: string;
  timestamp: string;
}

export interface PredictionOptionRow {
  id: string;
  title: string;
  totalBetAmount: number;
  users: number;
}

export interface PredictionRow {
  id: string;
  predictionId: string | null;
  channel: string | null;
  title: string | null;
  winningOutcome: string | null;
  createdAt: string | null;
  endedAt: string | null;
  lockedAt: string | null;
  options: PredictionOptionRow[];
  totalPoints: number;
  totalUsers: number;
  winningTitle: string | null;
}

export interface PollChoiceRow {
  id: string;
  title: string;
  votes: number;
  channelPointsVotes: number;
  bitsVotes: number;
  totalVotes: number;
}

export interface PollRow {
  id: string;
  pollId: string | null;
  channel: string | null;
  title: string | null;
  createdAt: string | null;
  endedAt: string | null;
  duration: number | null;
  choices: PollChoiceRow[];
  totalVotes: number;
  totalChannelPointsVotes: number;
  totalBitsVotes: number;
  totalAllVotes: number;
  winningTitle: string | null;
}

export interface EmojiRow {
  id: string;
  channel: string | null;
  username: string | null;
  message: string | null;
  emoji: string | null;
  timestamp: string | null;
}

/** Resposta paginada com `channels` extras — predictions/polls. */
export type PagedWithChannels<T> = PagedResponse<T> & { channels: string[] };
