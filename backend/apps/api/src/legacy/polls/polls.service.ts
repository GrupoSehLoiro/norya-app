import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { PollPersistence, PollSchemaName } from '@sehloro/infra';
import type { ListQuery, ExportQuery } from '../dto/list-query.dto';
import { buildFilter, paged, type PagedResult } from '../query.util';

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

@Injectable()
export class PollsService {
  constructor(
    @InjectModel(PollSchemaName)
    private readonly model: Model<PollPersistence>,
  ) {}

  async list(q: ListQuery): Promise<PagedResult<PollRow>> {
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

  async exportRows(q: ExportQuery): Promise<PollRow[]> {
    const filter = buildFilter(q, 'created_at');
    const docs = await this.model.find(filter).sort({ created_at: 1 }).lean().exec();
    return docs.map(toRow);
  }

  async listChannels(): Promise<string[]> {
    const distinct = await this.model.distinct<string>('channel').exec();
    return distinct.filter((c): c is string => Boolean(c));
  }
}

function toRow(doc: PollPersistence & { _id?: unknown }): PollRow {
  const choices: PollChoiceRow[] = (doc.choices ?? []).map((c) => {
    const votes = c.votes ?? 0;
    const cp = c.channel_points_votes ?? 0;
    const bits = c.bits_votes ?? 0;
    return {
      id: c.id,
      title: c.title,
      votes,
      channelPointsVotes: cp,
      bitsVotes: bits,
      totalVotes: votes + cp + bits,
    };
  });
  const totalVotes = choices.reduce((a, c) => a + c.votes, 0);
  const totalCp = choices.reduce((a, c) => a + c.channelPointsVotes, 0);
  const totalBits = choices.reduce((a, c) => a + c.bitsVotes, 0);
  const totalAll = totalVotes + totalCp + totalBits;
  const winning =
    choices.length > 0
      ? choices.reduce((top, c) => (c.totalVotes > top.totalVotes ? c : top))
      : null;
  return {
    id: String(doc._id ?? ''),
    pollId: doc.pollId ?? null,
    channel: doc.channel ?? null,
    title: doc.title ?? null,
    createdAt: doc.created_at ? doc.created_at.toISOString() : null,
    endedAt: doc.ended_at ? doc.ended_at.toISOString() : null,
    duration: doc.duration ?? null,
    choices,
    totalVotes,
    totalChannelPointsVotes: totalCp,
    totalBitsVotes: totalBits,
    totalAllVotes: totalAll,
    winningTitle: winning ? winning.title : null,
  };
}
