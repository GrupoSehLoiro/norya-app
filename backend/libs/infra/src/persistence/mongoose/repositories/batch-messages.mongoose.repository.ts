import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { RawMessage } from '@sehloro/domain';
import {
  BatchMessagesPersistence,
  BatchMessagesSchemaName,
} from '../schemas/batch-messages.schema';

export interface PersistedMessageRow {
  id: string;
  username: string;
  displayName?: string;
  isSubscriber: boolean;
  isMod: boolean;
  text: string;
  receivedAt: Date;
  sentimentHint?: string;
  emotes?: string[];
}

export interface BatchMessagesRow {
  batchId: string;
  channelId: string;
  windowStart: Date;
  windowEnd: Date;
  messageCount: number;
  uniqueUsers: number;
  messages: PersistedMessageRow[];
}

function toPersistedMessage(m: RawMessage, sentimentHint?: string) {
  return {
    id: m.id,
    username: m.user.username,
    displayName: m.user.displayName,
    isSubscriber: m.user.isSubscriber,
    isMod: m.user.isMod,
    text: m.text,
    receivedAt: m.receivedAt,
    sentimentHint,
    emotes: m.emotes?.map((e) => e.code),
  };
}

@Injectable()
export class BatchMessagesMongooseRepository {
  constructor(
    @InjectModel(BatchMessagesSchemaName)
    private readonly model: Model<BatchMessagesPersistence>,
  ) {}

  async save(args: {
    batchId: string;
    channelId: string;
    windowStart: Date;
    windowEnd: Date;
    messages: ReadonlyArray<RawMessage>;
    sentimentHints?: ReadonlyMap<string, string>;
  }): Promise<void> {
    if (args.messages.length === 0) return;
    const persisted = args.messages.map((m) =>
      toPersistedMessage(m, args.sentimentHints?.get(m.id)),
    );
    const uniqueUsers = new Set(args.messages.map((m) => m.user.username)).size;
    await this.model.create({
      batchId: args.batchId,
      channelId: args.channelId,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      messages: persisted,
      messageCount: args.messages.length,
      uniqueUsers,
    });
  }

  async listByChannel(channelId: string, limit = 100): Promise<BatchMessagesRow[]> {
    const docs = await this.model
      .find({ channelId }, { messages: 0 })
      .sort({ windowStart: -1 })
      .limit(Math.min(limit, 500))
      .lean()
      .exec();
    return docs.map((d) => ({
      batchId: d.batchId,
      channelId: d.channelId,
      windowStart: d.windowStart,
      windowEnd: d.windowEnd,
      messageCount: d.messageCount,
      uniqueUsers: d.uniqueUsers,
      messages: [],
    }));
  }

  /**
   * Lista batches COM mensagens completas, filtrados por janela de tempo.
   * Usado pelo endpoint de export — limite alto pra cobrir um dia inteiro
   * (5760 batches teóricos máx pra ticks de 15s).
   */
  async listByChannelInRange(args: {
    channelId: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<BatchMessagesRow[]> {
    const filter: Record<string, unknown> = { channelId: args.channelId };
    const windowStart: Record<string, Date> = {};
    if (args.from) windowStart.$gte = args.from;
    if (args.to) windowStart.$lte = args.to;
    if (Object.keys(windowStart).length > 0) filter.windowStart = windowStart;

    const docs = await this.model
      .find(filter)
      .sort({ windowStart: 1 })
      .limit(Math.min(args.limit ?? 10000, 10000))
      .lean()
      .exec();

    return docs.map((d) => ({
      batchId: d.batchId,
      channelId: d.channelId,
      windowStart: d.windowStart,
      windowEnd: d.windowEnd,
      messageCount: d.messageCount,
      uniqueUsers: d.uniqueUsers,
      messages: (d.messages ?? []).map((m) => ({
        id: m.id,
        username: m.username,
        displayName: m.displayName,
        isSubscriber: m.isSubscriber,
        isMod: m.isMod,
        text: m.text,
        receivedAt: m.receivedAt,
        sentimentHint: m.sentimentHint,
        emotes: m.emotes,
      })),
    }));
  }

  async findByBatchId(batchId: string): Promise<BatchMessagesRow | null> {
    const doc = await this.model.findOne({ batchId }).lean().exec();
    if (!doc) return null;
    return {
      batchId: doc.batchId,
      channelId: doc.channelId,
      windowStart: doc.windowStart,
      windowEnd: doc.windowEnd,
      messageCount: doc.messageCount,
      uniqueUsers: doc.uniqueUsers,
      messages: doc.messages ?? [],
    };
  }
}

export { toPersistedMessage };
