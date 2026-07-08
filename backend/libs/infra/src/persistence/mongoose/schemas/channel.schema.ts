/**
 * Schema Mongoose para a collection `channels` (database `sehloirostudios`).
 *
 * Campos legados mantidos para backward-compat (bots e SLMOD-api):
 *   - `channel` (unique-sparse)
 *   - `channelWithPrefix`
 *   - `created_at`
 *   - `active`
 *
 * Campos novos (ORC-01):
 *   - `platform` (default 'twitch')
 *   - `externalId` (Twitch user_id ou Kick channel.id)
 *   - `displayName`
 *   - `ownerId` (ref User)
 *   - `flags` (Map<string, boolean> para feature flags por canal)
 *   - `metadata` (Map livre para dados extras da plataforma)
 *
 * Índice único composto (platform, externalId) para prevenir duplicatas
 * multi-plataforma. `channel` mantém unique-sparse para docs legados.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const ChannelSchemaName = 'Channel';

@Schema({
  collection: 'channels',
  _id: false,
  timestamps: { createdAt: false, updatedAt: 'updatedAt' },
})
export class ChannelPersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, unique: true, sparse: true })
  channel!: string;

  @Prop({ type: String })
  channelWithPrefix!: string;

  @Prop({ type: Date, required: true, default: Date.now })
  created_at!: Date;

  @Prop({ type: Boolean, default: true })
  active!: boolean;

  @Prop({ type: String, enum: ['twitch', 'kick', 'youtube'], default: 'twitch', required: true })
  platform!: string;

  @Prop({ type: String, index: true, sparse: true })
  externalId?: string;

  @Prop({ type: String })
  displayName?: string;

  @Prop({ type: String, index: true })
  ownerId?: string;

  /**
   * Creator dono desta integração (multi-plataforma). NOVO — opcional para não
   * quebrar docs legados; preenchido pela migração 003 e pelo onboarding.
   */
  @Prop({ type: String, index: true })
  creatorId?: string;

  /** Workspace (tenant) ao qual a integração pertence. NOVO — opcional. */
  @Prop({ type: String, index: true })
  workspaceId?: string;

  @Prop({ type: Map, of: Boolean, default: {} })
  flags?: Map<string, boolean>;

  @Prop({ type: Map, of: Object, default: {} })
  metadata?: Map<string, unknown>;

  updatedAt?: Date;
}

export type ChannelDocument = HydratedDocument<ChannelPersistence>;

export const ChannelSchema = SchemaFactory.createForClass(ChannelPersistence);

// Índice único composto para multi-plataforma. ATENÇÃO: `sparse` em índice
// COMPOSTO não serve aqui — ele só ignora docs sem NENHUM dos campos, então
// dois canais legados com `platform` mas sem `externalId` colidiam em
// (platform, null) com E11000. `partialFilterExpression` indexa apenas docs
// onde externalId é string — canais legados (sem externalId) ficam fora.
ChannelSchema.index(
  { platform: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
