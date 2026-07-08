/**
 * Adapter Mongoose para `MembershipRepository`. `save` = upsert por `_id`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Membership, MembershipRepository, MembershipStatus, WsRole } from '@sehloro/domain';
import {
  MembershipDocument,
  MembershipPersistence,
  MembershipSchemaName,
} from '../schemas/membership.schema';

@Injectable()
export class MembershipMongooseRepository implements MembershipRepository {
  constructor(
    @InjectModel(MembershipSchemaName)
    private readonly model: Model<MembershipPersistence>,
  ) {}

  async findById(id: string): Promise<Membership | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByUserAndWorkspace(userId: string, workspaceId: string): Promise<Membership | null> {
    const doc = await this.model.findOne({ userId, workspaceId }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByUserId(userId: string): Promise<Membership[]> {
    const docs = await this.model.find({ userId }).exec();
    return docs.map((d) => this.toDomain(d));
  }

  async findByWorkspaceId(workspaceId: string): Promise<Membership[]> {
    const docs = await this.model.find({ workspaceId }).exec();
    return docs.map((d) => this.toDomain(d));
  }

  async save(membership: Membership): Promise<Membership> {
    const { _id, ...rest } = membership.toPersistence();
    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) throw new Error(`Falha ao persistir Membership id=${_id}`);
      return this.toDomain(reread);
    }
    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  private toDomain(doc: MembershipDocument): Membership {
    return Membership.reconstitute({
      _id: String(doc._id),
      workspaceId: doc.workspaceId,
      userId: doc.userId,
      role: doc.role as WsRole,
      status: doc.status as MembershipStatus,
      invitedEmail: doc.invitedEmail ?? null,
      createdAt: doc.createdAt,
    });
  }
}
