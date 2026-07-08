/**
 * Adapter Mongoose para `WorkspaceRepository`. `save` = upsert por `_id`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DocumentType,
  PlanKey,
  SubscriptionStatus,
  Workspace,
  WorkspaceRepository,
  WorkspaceType,
} from '@sehloro/domain';
import {
  WorkspaceDocument,
  WorkspacePersistence,
  WorkspaceSchemaName,
} from '../schemas/workspace.schema';

@Injectable()
export class WorkspaceMongooseRepository implements WorkspaceRepository {
  constructor(
    @InjectModel(WorkspaceSchemaName)
    private readonly model: Model<WorkspacePersistence>,
  ) {}

  async findById(id: string): Promise<Workspace | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const doc = await this.model.findOne({ slug }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByOwnerUserId(ownerUserId: string): Promise<Workspace[]> {
    const docs = await this.model.find({ ownerUserId }).exec();
    return docs.map((d) => this.toDomain(d));
  }

  async save(workspace: Workspace): Promise<Workspace> {
    const { _id, ...rest } = workspace.toPersistence();
    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) throw new Error(`Falha ao persistir Workspace id=${_id}`);
      return this.toDomain(reread);
    }
    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  private toDomain(doc: WorkspaceDocument): Workspace {
    return Workspace.reconstitute({
      _id: String(doc._id),
      name: doc.name,
      slug: doc.slug,
      type: doc.type as WorkspaceType,
      ownerUserId: doc.ownerUserId,
      planKey: doc.planKey as PlanKey,
      subscriptionStatus: doc.subscriptionStatus as SubscriptionStatus,
      subscriptionStartedAt: doc.subscriptionStartedAt,
      createdAt: doc.createdAt,
      document: doc.document ?? null,
      documentType: (doc.documentType as DocumentType | null) ?? null,
    });
  }
}
