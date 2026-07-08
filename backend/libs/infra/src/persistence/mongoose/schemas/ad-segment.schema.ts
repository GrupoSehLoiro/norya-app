/**
 * M4 Fase 3 — Mongoose schema do AdSegment.
 *
 * Source of truth do estado de "tem ad rolando" por canal. ClickHouse
 * espelha para joins analíticos.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const AdSegmentSchemaName = 'AdSegment';

@Schema({
  collection: 'ad_segments',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class AdSegmentPersistence {
  @Prop({ type: String, required: true, index: true })
  channelId!: string;

  @Prop({ type: String, default: null })
  sessionId!: string | null;

  @Prop({ type: String, enum: ['twitch', 'manual'], required: true })
  source!: 'twitch' | 'manual';

  @Prop({ type: Date, required: true, index: true })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  endedAt!: Date | null;

  @Prop({ type: Number, default: null })
  durationSeconds!: number | null;

  @Prop({ type: Boolean, default: false })
  isAutomatic!: boolean;

  @Prop({ type: Object, default: null })
  rawPayload?: unknown;
}

export type AdSegmentDocument = HydratedDocument<AdSegmentPersistence>;
export const AdSegmentSchema = SchemaFactory.createForClass(AdSegmentPersistence);
AdSegmentSchema.index({ channelId: 1, startedAt: -1 });
