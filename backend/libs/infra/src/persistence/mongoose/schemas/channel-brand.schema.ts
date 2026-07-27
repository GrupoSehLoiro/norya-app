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
  /**
   * Creator dono da marca — allowlist no nível do criador e EIXO PRINCIPAL de
   * escopo. A marca é individual do criador, não do canal: a mesma conta de
   * plataforma pode ser reaproveitada por donos diferentes, então escopar por
   * canal vazava marcas entre usuários. Preenchido no onboarding/CRUD e pela
   * migração 003 (`migrate-channel-brands-creator.js`).
   */
  @Prop({ type: String, required: true, index: true })
  creatorId!: string;

  /**
   * Canal de origem no momento da criação (proveniência/legado). Opcional —
   * listagem e detecção passaram a operar por `creatorId`.
   */
  @Prop({ type: String, index: true })
  channelId?: string | null;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  aliases!: string[];

  @Prop({ type: String, default: null })
  regex!: string | null;
}

export type ChannelBrandDocument = HydratedDocument<ChannelBrandPersistence>;
export const ChannelBrandSchema = SchemaFactory.createForClass(ChannelBrandPersistence);
// Unicidade por criador (não por canal): cada creator tem sua própria marca.
// O índice legado `{ channelId, name }` é derrubado pela migração 003.
ChannelBrandSchema.index({ creatorId: 1, name: 1 }, { unique: true });
