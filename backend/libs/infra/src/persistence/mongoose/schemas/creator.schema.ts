/**
 * Schema Mongoose para a collection `creators` (o "canal" de produto).
 * Agrupa integrações + carrega o perfil. Collection nova.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const CreatorSchemaName = 'Creator';

@Schema({ collection: 'creators', _id: false })
export class CreatorPersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true, index: true })
  workspaceId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  slug!: string;

  @Prop({ type: String, enum: ['active', 'archived'], default: 'active', required: true })
  status!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;
}

export type CreatorDocument = HydratedDocument<CreatorPersistence>;
export const CreatorSchema = SchemaFactory.createForClass(CreatorPersistence);

// Slug único por workspace.
CreatorSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });
