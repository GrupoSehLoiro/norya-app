/**
 * Adapter Mongoose para `ChannelRepository`.
 * Mesma estratégia de upsert do UserMongooseRepository — ver comentários lá.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelFilterOptions, ChannelPage, ChannelRepository } from '@sehloro/domain';
import { ChannelPersistence, ChannelSchemaName } from '../schemas/channel.schema';
import { toDomain, toPersistence } from '../mappers/channel.mapper';

@Injectable()
export class ChannelMongooseRepository implements ChannelRepository {
  constructor(
    @InjectModel(ChannelSchemaName)
    private readonly model: Model<ChannelPersistence>,
  ) {}

  async findById(id: string): Promise<Channel | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? toDomain(doc) : null;
  }

  /** Busca pelo nome legado (campo Mongo `channel`). */
  async findByName(name: string): Promise<Channel | null> {
    const doc = await this.model.findOne({ channel: name }).exec();
    return doc ? toDomain(doc) : null;
  }

  async findAllActive(): Promise<Channel[]> {
    const docs = await this.model.find({ active: true }).exec();
    return docs.map(toDomain);
  }

  async findMany(filters: ChannelFilterOptions): Promise<ChannelPage> {
    const query: Record<string, unknown> = {};
    if (filters.platform !== undefined) query.platform = filters.platform;
    if (filters.active !== undefined) query.active = filters.active;
    if (filters.ownerId !== undefined) query.ownerId = filters.ownerId;
    if (filters.workspaceId !== undefined) query.workspaceId = filters.workspaceId;

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [docs, total] = await Promise.all([
      this.model.find(query).skip(skip).limit(pageSize).exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return { channels: docs.map(toDomain), total };
  }

  async countByCreatorId(creatorId: string): Promise<number> {
    return this.model.countDocuments({ creatorId }).exec();
  }

  async findByCreatorId(creatorId: string): Promise<Channel[]> {
    const docs = await this.model.find({ creatorId }).exec();
    return docs.map(toDomain);
  }

  async findUnlinkedByOwner(ownerId: string): Promise<Channel[]> {
    const docs = await this.model.find({ ownerId, creatorId: { $in: [null, undefined] } }).exec();
    return docs.map(toDomain);
  }

  async save(channel: Channel): Promise<Channel> {
    const payload = toPersistence(channel);
    const { _id, ...rest } = payload;

    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) {
        throw new Error(`Falha ao persistir Channel id=${_id}`);
      }
      return toDomain(reread);
    }

    return toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }
}
