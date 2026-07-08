/**
 * Schema Mongoose para a collection `creator_profiles` (1:1 com Creator).
 * Contexto do onboarding (nicho/categoria/…). Collection nova.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const CreatorProfileSchemaName = 'CreatorProfile';

@Schema({ collection: 'creator_profiles', _id: false })
export class CreatorProfilePersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true, unique: true })
  creatorId!: string;

  @Prop({ type: String, default: '' })
  niche!: string;

  @Prop({ type: String, default: '' })
  category!: string;

  @Prop({ type: String, default: '' })
  subcategory!: string;

  @Prop({ type: String, default: '' })
  genre!: string;

  /** Objeto livre { ageRange?, gender?, size?, region? }. */
  @Prop({ type: Object, default: {} })
  audience!: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  updatedAt!: Date;
}

export type CreatorProfileDocument = HydratedDocument<CreatorProfilePersistence>;
export const CreatorProfileSchema = SchemaFactory.createForClass(CreatorProfilePersistence);
