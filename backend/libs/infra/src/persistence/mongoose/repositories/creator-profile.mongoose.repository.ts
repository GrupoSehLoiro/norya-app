/**
 * Adapter Mongoose para `CreatorProfileRepository`. `save` = upsert por `_id`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreatorAudience, CreatorProfile, CreatorProfileRepository } from '@sehloro/domain';
import {
  CreatorProfileDocument,
  CreatorProfilePersistence,
  CreatorProfileSchemaName,
} from '../schemas/creator-profile.schema';

@Injectable()
export class CreatorProfileMongooseRepository implements CreatorProfileRepository {
  constructor(
    @InjectModel(CreatorProfileSchemaName)
    private readonly model: Model<CreatorProfilePersistence>,
  ) {}

  async findByCreatorId(creatorId: string): Promise<CreatorProfile | null> {
    const doc = await this.model.findOne({ creatorId }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async save(profile: CreatorProfile): Promise<CreatorProfile> {
    const { _id, ...rest } = profile.toPersistence();
    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) throw new Error(`Falha ao persistir CreatorProfile id=${_id}`);
      return this.toDomain(reread);
    }
    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  private toDomain(doc: CreatorProfileDocument): CreatorProfile {
    return CreatorProfile.reconstitute({
      _id: String(doc._id),
      creatorId: doc.creatorId,
      niche: doc.niche ?? '',
      category: doc.category ?? '',
      subcategory: doc.subcategory ?? '',
      genre: doc.genre ?? '',
      audience: (doc.audience ?? {}) as CreatorAudience,
      tags: doc.tags ?? [],
      completedAt: doc.completedAt ?? null,
      updatedAt: doc.updatedAt,
    });
  }
}
