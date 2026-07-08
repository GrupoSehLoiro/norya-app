/**
 * Schema Mongoose para a collection `memberships` (User ↔ Workspace + role).
 * O RBAC mora aqui. Collection nova.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const MembershipSchemaName = 'Membership';

@Schema({ collection: 'memberships', _id: false })
export class MembershipPersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true, index: true })
  workspaceId!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({
    type: String,
    enum: ['owner', 'admin', 'manager', 'analyst', 'viewer'],
    required: true,
  })
  role!: string;

  @Prop({ type: String, enum: ['active', 'invited', 'revoked'], default: 'active', required: true })
  status!: string;

  @Prop({ type: String, default: null })
  invitedEmail!: string | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;
}

export type MembershipDocument = HydratedDocument<MembershipPersistence>;
export const MembershipSchema = SchemaFactory.createForClass(MembershipPersistence);

// Um usuário tem no máximo UMA membership por workspace.
MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
