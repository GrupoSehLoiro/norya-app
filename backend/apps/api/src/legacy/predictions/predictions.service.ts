import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { PredictionPersistence, PredictionSchemaName } from '@sehloro/infra';
import type { ListQuery, ExportQuery } from '../dto/list-query.dto';
import { buildFilter, paged, type PagedResult } from '../query.util';

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

@Injectable()
export class PredictionsService {
  constructor(
    @InjectModel(PredictionSchemaName)
    private readonly model: Model<PredictionPersistence>,
  ) {}

  async list(q: ListQuery): Promise<PagedResult<PredictionRow>> {
    const filter = buildFilter(q, 'created_at');
    const [docs, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ created_at: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return paged(docs.map(toRow), total, q);
  }

  async exportRows(q: ExportQuery): Promise<PredictionRow[]> {
    const filter = buildFilter(q, 'created_at');
    const docs = await this.model.find(filter).sort({ created_at: 1 }).lean().exec();
    return docs.map(toRow);
  }

  async listChannels(): Promise<string[]> {
    const distinct = await this.model.distinct<string>('channel').exec();
    return distinct.filter((c): c is string => Boolean(c));
  }
}

function toRow(doc: PredictionPersistence & { _id?: unknown }): PredictionRow {
  const options = (doc.options ?? []).map((o) => ({
    id: o.id,
    title: o.title,
    totalBetAmount: o.totalBetAmount ?? 0,
    users: o.users ?? 0,
  }));
  const totalPoints = options.reduce((acc, o) => acc + o.totalBetAmount, 0);
  const totalUsers = options.reduce((acc, o) => acc + o.users, 0);
  const winning = options.find((o) => o.id === doc.winningOutcome) ?? null;
  return {
    id: String(doc._id ?? ''),
    predictionId: doc.predictionId ?? null,
    channel: doc.channel ?? null,
    title: doc.title ?? null,
    winningOutcome: doc.winningOutcome ?? null,
    createdAt: doc.created_at ? doc.created_at.toISOString() : null,
    endedAt: doc.ended_at ? doc.ended_at.toISOString() : null,
    lockedAt: doc.locked_at ? doc.locked_at.toISOString() : null,
    options,
    totalPoints,
    totalUsers,
    winningTitle: winning ? winning.title : null,
  };
}
