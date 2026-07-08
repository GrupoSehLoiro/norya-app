/**
 * MessageSearchService — busca de mensagens do chat. Lê do Mongo `batch_messages`
 * (snapshot das mensagens por batch salvo pelo orchestrator — é onde o texto
 * cru realmente vive), filtrando por termo (ex.: "redbull") e janela de data,
 * com separação orgânico vs mod.
 *
 * (O `chat_messages` no ClickHouse só é populado pelo ChatIngestService do
 * worker; no setup atual a fonte de verdade do texto é o batch_messages.)
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BatchMessagesSchemaName } from '@sehloro/infra';

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

interface SearchParams {
  channelId: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}

interface PersistedMsg {
  id: string;
  username: string;
  isMod?: boolean;
  isSubscriber?: boolean;
  text: string;
  receivedAt: Date | string;
  sentimentHint?: string;
}
interface BatchDoc {
  channelId: string;
  windowStart: Date;
  messages: PersistedMsg[];
}

@Injectable()
export class MessageSearchService {
  constructor(
    @InjectModel(BatchMessagesSchemaName)
    private readonly model: Model<BatchDoc>,
  ) {}

  async search(p: SearchParams): Promise<MessageSearchResult> {
    const cap = Math.min(500, Math.max(1, p.limit ?? 100));
    const term = (p.q ?? '').trim().toLowerCase();

    const filter: Record<string, unknown> = { channelId: p.channelId };
    if (p.from || p.to) {
      const ws: Record<string, Date> = {};
      if (p.from) ws.$gte = new Date(p.from);
      if (p.to) ws.$lte = new Date(p.to);
      filter.windowStart = ws;
    }

    const docs = await this.model.find(filter).sort({ windowStart: -1 }).limit(1000).lean().exec();

    let total = 0;
    let fromMods = 0;
    const items: MessageHit[] = [];
    for (const d of docs as unknown as BatchDoc[]) {
      for (const m of d.messages ?? []) {
        if (term && !(m.text ?? '').toLowerCase().includes(term)) continue;
        total += 1;
        if (m.isMod) fromMods += 1;
        items.push({
          messageId: m.id,
          username: m.username,
          text: m.text,
          isMod: Boolean(m.isMod),
          isSubscriber: Boolean(m.isSubscriber),
          sentiment: m.sentimentHint ?? 'neutral',
          receivedAt:
            m.receivedAt instanceof Date ? m.receivedAt.toISOString() : String(m.receivedAt),
        });
      }
    }
    items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

    return {
      channelId: p.channelId,
      query: term,
      total,
      fromMods,
      organic: total - fromMods,
      items: items.slice(0, cap),
    };
  }
}
