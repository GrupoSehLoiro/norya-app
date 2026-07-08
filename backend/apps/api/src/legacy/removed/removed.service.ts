import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { MessageDeletedPersistence, MessageDeletedSchemaName } from '@sehloro/infra';
import type { ListQuery, ExportQuery } from '../dto/list-query.dto';
import { buildFilter, paged, type PagedResult, type CountByChannelRow } from '../query.util';

export interface RemovedRow {
  id: string;
  channel: string;
  username: string;
  deletedMessage: string;
  timestamp: string;
}

@Injectable()
export class RemovedMessagesService {
  constructor(
    @InjectModel(MessageDeletedSchemaName)
    private readonly model: Model<MessageDeletedPersistence>,
  ) {}

  async list(q: ListQuery): Promise<PagedResult<RemovedRow>> {
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

  async exportRows(q: ExportQuery): Promise<RemovedRow[]> {
    const filter = buildFilter(q, 'timestamp');
    const docs = await this.model.find(filter).sort({ timestamp: 1 }).lean().exec();
    return docs.map(toRow);
  }
}

function toRow(doc: MessageDeletedPersistence & { _id?: unknown }): RemovedRow {
  return {
    id: String(doc._id ?? ''),
    channel: doc.channel,
    username: doc.username,
    deletedMessage: doc.deletedMessage,
    timestamp: doc.timestamp.toISOString(),
  };
}
