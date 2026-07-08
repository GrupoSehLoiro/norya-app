/**
 * Adapter Mongoose para `CreatorRepository`. `save` = upsert por `_id`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Creator, CreatorRepository, CreatorStatus } from '@sehloro/domain';
import { CreatorDocument, CreatorPersistence, CreatorSchemaName } from '../schemas/creator.schema';

@Injectable()
export class CreatorMongooseRepository implements CreatorRepository {
  constructor(
    @InjectModel(CreatorSchemaName)
    private readonly model: Model<CreatorPersistence>,
  ) {}

  async findById(id: string): Promise<Creator | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByWorkspaceId(workspaceId: string): Promise<Creator[]> {
    const docs = await this.model.find({ workspaceId }).exec();
    return docs.map((d) => this.toDomain(d));
  }

  async countByWorkspaceId(workspaceId: string): Promise<number> {
    return this.model.countDocuments({ workspaceId }).exec();
  }

  async save(creator: Creator): Promise<Creator> {
    const { _id, ...rest } = creator.toPersistence();
    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) throw new Error(`Falha ao persistir Creator id=${_id}`);
      return this.toDomain(reread);
    }
    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  private toDomain(doc: CreatorDocument): Creator {
    return Creator.reconstitute({
      _id: String(doc._id),
      workspaceId: doc.workspaceId,
      name: doc.name,
      slug: doc.slug,
      status: doc.status as CreatorStatus,
      createdAt: doc.createdAt,
    });
  }
}
