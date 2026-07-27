import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ChannelBrand, ChannelBrandRepository } from '@sehloro/domain';
import { ChannelBrandPersistence, ChannelBrandSchemaName } from '../schemas/channel-brand.schema';

@Injectable()
export class ChannelBrandMongooseRepository implements ChannelBrandRepository {
  constructor(
    @InjectModel(ChannelBrandSchemaName)
    private readonly model: Model<ChannelBrandPersistence>,
  ) {}

  async create(input: Parameters<ChannelBrandRepository['create']>[0]): Promise<ChannelBrand> {
    const doc = await this.model.create({
      creatorId: input.creatorId,
      channelId: input.channelId ?? null,
      name: input.name,
      aliases: input.aliases ?? [],
      regex: input.regex ?? null,
    });
    return this._toEntity(doc);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  async findById(id: string): Promise<ChannelBrand | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? this._toEntity(doc) : null;
  }

  async listByCreator(creatorId: string): Promise<ChannelBrand[]> {
    const docs = await this.model.find({ creatorId }).exec();
    return docs.map((d) => this._toEntity(d));
  }

  private _toEntity(
    doc: ChannelBrandPersistence & { _id: unknown; createdAt?: Date },
  ): ChannelBrand {
    return {
      id: String(doc._id),
      creatorId: doc.creatorId,
      channelId: doc.channelId ?? null,
      name: doc.name,
      aliases: doc.aliases ?? [],
      regex: doc.regex ?? null,
      createdAt: doc.createdAt ?? new Date(),
    };
  }
}
