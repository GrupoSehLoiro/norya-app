/**
 * Schema Mongoose para a collection `workspaces` (tenant + billing).
 * Collection nova — nomes em camelCase do domínio.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const WorkspaceSchemaName = 'Workspace';

@Schema({ collection: 'workspaces', _id: false })
export class WorkspacePersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, unique: true })
  slug!: string;

  @Prop({ type: String, enum: ['creator', 'agency', 'brand'], default: 'creator', required: true })
  type!: string;

  @Prop({ type: String, required: true, index: true })
  ownerUserId!: string;

  @Prop({ type: String, default: 'free', required: true })
  planKey!: string;

  @Prop({ type: String, default: 'active', required: true })
  subscriptionStatus!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  subscriptionStartedAt!: Date;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: String, default: null })
  document!: string | null;

  @Prop({ type: String, enum: ['cpf', 'cnpj', null], default: null })
  documentType!: string | null;
}

export type WorkspaceDocument = HydratedDocument<WorkspacePersistence>;
export const WorkspaceSchema = SchemaFactory.createForClass(WorkspacePersistence);
