export interface BatchMessage {
  id: string;
  username: string;
  displayName?: string;
  isSubscriber: boolean;
  isMod: boolean;
  text: string;
  receivedAt: string;
  sentimentHint?: 'positive' | 'negative' | 'neutral' | string;
  emotes?: string[];
}

export interface BatchSummary {
  batchId: string;
  channelId: string;
  windowStart: string;
  windowEnd: string;
  messageCount: number;
  uniqueUsers: number;
}

export interface BatchDetail extends BatchSummary {
  messages: BatchMessage[];
}

export interface BatchListResponse {
  channelId: string;
  items: BatchSummary[];
}
