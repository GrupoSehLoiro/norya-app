/**
 * M4 Fase 3 — Mongoose schema do ChannelBrand (allowlist de marcas).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const ChannelBrandSchemaName = 'ChannelBrand';

@Schema({
  collection: 'channel_brands',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class ChannelBrandPersistence {
  @Prop({ type: String, required: true, index: true })
  channelId!: string;

  /**
   * Creator dono da marca (allowlist no nível do criador). NOVO — opcional na
   * transição; a detecção carimba a plataforma de origem da menção. Preenchido
   * pela migração 003 e pelo onboarding. Em Fase 2 vira o eixo principal.
   */
  @Prop({ type: String, index: true })
  creatorId?: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  aliases!: string[];

  @Prop({ type: String, default: null })
  regex!: string | null;
}

export type ChannelBrandDocument = HydratedDocument<ChannelBrandPersistence>;
export const ChannelBrandSchema = SchemaFactory.createForClass(ChannelBrandPersistence);
ChannelBrandSchema.index({ channelId: 1, name: 1 }, { unique: true });
