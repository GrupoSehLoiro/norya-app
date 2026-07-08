import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AdSegment, AdSegmentRepository } from '@sehloro/domain';
import { AdSegmentPersistence, AdSegmentSchemaName } from '../schemas/ad-segment.schema';

@Injectable()
export class AdSegmentMongooseRepository implements AdSegmentRepository {
  constructor(
    @InjectModel(AdSegmentSchemaName)
    private readonly model: Model<AdSegmentPersistence>,
  ) {}

  async create(input: Parameters<AdSegmentRepository['create']>[0]): Promise<AdSegment> {
    const doc = await this.model.create({
      channelId: input.channelId,
      sessionId: input.sessionId,
      source: input.source,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      durationSeconds: input.durationSeconds ?? null,
      isAutomatic: input.isAutomatic ?? false,
      rawPayload: input.rawPayload ?? null,
    });
    return this._toEntity(doc);
  }

  async closeOpen(channelId: string, endedAt: Date): Promise<AdSegment | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { channelId, endedAt: null },
        {
          $set: {
            endedAt,
            durationSeconds: null, // será recomputado abaixo
          },
        },
        { sort: { startedAt: -1 }, new: true },
      )
      .exec();
    if (!doc) return null;
    // Recompute durationSeconds
    doc.durationSeconds = Math.round((doc.endedAt!.getTime() - doc.startedAt.getTime()) / 1000);
    await doc.save();
    return this._toEntity(doc);
  }

  async findOpen(channelId: string): Promise<AdSegment | null> {
    const doc = await this.model
      .findOne({ channelId, endedAt: null })
      .sort({ startedAt: -1 })
      .exec();
    return doc ? this._toEntity(doc) : null;
  }

  async findOverlapping(channelId: string, from: Date, to: Date): Promise<AdSegment[]> {
    const docs = await this.model
      .find({
        channelId,
        startedAt: { $lte: to },
        $or: [{ endedAt: null }, { endedAt: { $gte: from } }],
      })
      .sort({ startedAt: 1 })
      .exec();
    return docs.map((d) => this._toEntity(d));
  }

  private _toEntity(doc: AdSegmentPersistence & { _id: unknown }): AdSegment {
    return {
      id: String(doc._id),
      channelId: doc.channelId,
      sessionId: doc.sessionId ?? null,
      source: doc.source,
      startedAt: doc.startedAt,
      endedAt: doc.endedAt ?? null,
      durationSeconds: doc.durationSeconds ?? null,
      isAutomatic: doc.isAutomatic ?? false,
      rawPayload: doc.rawPayload,
    };
  }
}
