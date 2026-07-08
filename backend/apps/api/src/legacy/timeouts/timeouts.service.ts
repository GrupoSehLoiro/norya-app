import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { TimeoutPersistence, TimeoutSchemaName } from '@sehloro/infra';
import type { ListQuery, ExportQuery } from '../dto/list-query.dto';
import { buildFilter, paged, type PagedResult, type CountByChannelRow } from '../query.util';

export interface TimeoutRow {
  id: string;
  channel: string;
  userName: string;
  reason: string;
  tempoDeTO: number;
  modName: string;
  timestamp: string;
}

@Injectable()
export class TimeoutsService {
  constructor(
    @InjectModel(TimeoutSchemaName)
    private readonly model: Model<TimeoutPersistence>,
  ) {}

  async list(q: ListQuery): Promise<PagedResult<TimeoutRow>> {
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

  async exportRows(q: ExportQuery): Promise<TimeoutRow[]> {
    const filter = buildFilter(q, 'timestamp');
    const docs = await this.model.find(filter).sort({ timestamp: 1 }).lean().exec();
    return docs.map(toRow);
  }
}

function toRow(doc: TimeoutPersistence & { _id?: unknown }): TimeoutRow {
  return {
    id: String(doc._id ?? ''),
    channel: doc.channel,
    userName: doc.userName,
    reason: doc.reason,
    tempoDeTO: doc.tempoDeTO,
    modName: doc.modName,
    timestamp: doc.timestamp.toISOString(),
  };
}
