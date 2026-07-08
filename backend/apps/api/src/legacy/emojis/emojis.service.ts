import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ChatEmojiPersistence, ChatEmojiSchemaName } from '@sehloro/infra';
import type { ListQuery, ExportQuery } from '../dto/list-query.dto';
import { buildFilter, paged, type PagedResult, type CountByChannelRow } from '../query.util';

export interface EmojiRow {
  id: string;
  channel: string | null;
  username: string | null;
  message: string | null;
  emoji: string | null;
  timestamp: string | null;
}

@Injectable()
export class EmojisService {
  constructor(
    @InjectModel(ChatEmojiSchemaName)
    private readonly model: Model<ChatEmojiPersistence>,
  ) {}

  async list(q: ListQuery): Promise<PagedResult<EmojiRow>> {
    const filter = buildFilter(q, 'timestamp');
    const [docs, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ timestamp: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return paged(docs.map(toRow), total, q);
  }

  count(): Promise<number> {
    return this.model.countDocuments().exec();
  }

  async countByChannel(): Promise<CountByChannelRow[]> {
    const agg = await this.model
      .aggregate<{
        _id: string;
        count: number;
      }>([{ $group: { _id: '$channel', count: { $sum: 1 } } }, { $sort: { count: -1 } }])
      .exec();
    return agg.map((a) => ({ channel: a._id ?? '', count: a.count }));
  }

  async exportRows(q: ExportQuery): Promise<EmojiRow[]> {
    const filter = buildFilter(q, 'timestamp');
    const docs = await this.model.find(filter).sort({ timestamp: 1 }).lean().exec();
    return docs.map(toRow);
  }
}

function toRow(doc: ChatEmojiPersistence & { _id?: unknown }): EmojiRow {
  return {
    id: String(doc._id ?? ''),
    channel: doc.channel ?? null,
    username: doc.username ?? null,
    message: doc.message ?? null,
    emoji: doc.emoji ?? null,
    timestamp: doc.timestamp ? doc.timestamp.toISOString() : null,
  };
}
