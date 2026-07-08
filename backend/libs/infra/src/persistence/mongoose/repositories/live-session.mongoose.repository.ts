/**
 * MON-01 · Adapter Mongoose para LiveSessionRepository.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LiveSession, LiveSessionPersistenceShape, LiveSessionRepository } from '@sehloro/domain';
import { LiveSessionPersistence, LiveSessionSchemaName } from '../schemas/live-session.schema';

function toDomain(doc: LiveSessionPersistence): LiveSession {
  return LiveSession.reconstitute({
    _id: String(doc._id),
    channelId: doc.channelId,
    platform: doc.platform as 'twitch' | 'kick',
    state: doc.state as 'SCHEDULED' | 'ACTIVE' | 'ENDED',
    title: doc.title,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    peakViewerCount: doc.peakViewerCount,
    avgViewerCount: doc.avgViewerCount,
    totalMessages: doc.totalMessages ?? 0,
    summary: doc.summary,
    autoStarted: doc.autoStarted ?? false,
    createdAt: doc.createdAt ?? new Date(),
  });
}

@Injectable()
export class LiveSessionMongooseRepository implements LiveSessionRepository {
  constructor(
    @InjectModel(LiveSessionSchemaName)
    private readonly model: Model<LiveSessionPersistence>,
  ) {}

  async findById(id: string): Promise<LiveSession | null> {
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toDomain(doc as unknown as LiveSessionPersistence) : null;
  }

  async findActiveByChannel(channelId: string): Promise<LiveSession | null> {
    const doc = await this.model.findOne({ channelId, state: 'ACTIVE' }).lean().exec();
    return doc ? toDomain(doc as unknown as LiveSessionPersistence) : null;
  }

  async findMany(filters: {
    channelId?: string;
    state?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ sessions: LiveSession[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (filters.channelId) query.channelId = filters.channelId;
    if (filters.state) query.state = filters.state;
    if (filters.from || filters.to) {
      query.startedAt = {};
      if (filters.from) (query.startedAt as Record<string, unknown>)['$gte'] = filters.from;
      if (filters.to) (query.startedAt as Record<string, unknown>)['$lte'] = filters.to;
    }

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [docs, total] = await Promise.all([
      this.model.find(query).sort({ startedAt: -1 }).skip(skip).limit(pageSize).lean().exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      sessions: (docs as unknown as LiveSessionPersistence[]).map(toDomain),
      total,
    };
  }

  async save(session: LiveSession): Promise<LiveSession> {
    const payload = session.toPersistence() as LiveSessionPersistenceShape & { lastEventAt?: Date };
    const { _id, ...rest } = payload;

    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    return toDomain(updated as unknown as LiveSessionPersistence);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  async findStaleActive(threshold: Date): Promise<LiveSession[]> {
    // ACTIVE + (lastEventAt < threshold) OU (lastEventAt ausente E startedAt < threshold).
    // O segundo ramo cobre sessões que abriram e nunca receberam evento de chat
    // (auto-fechar evita LiveSession eterna se o offline foi perdido).
    const docs = await this.model
      .find({
        state: 'ACTIVE',
        $or: [
          { lastEventAt: { $lt: threshold } },
          { lastEventAt: { $exists: false }, startedAt: { $lt: threshold } },
          { lastEventAt: null, startedAt: { $lt: threshold } },
        ],
      })
      .lean()
      .exec();

    return (docs as unknown as LiveSessionPersistence[]).map(toDomain);
  }
}
