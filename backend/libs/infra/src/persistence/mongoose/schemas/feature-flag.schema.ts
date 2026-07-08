/**
 * FF-01 · Schema Mongoose para feature flags.
 *
 * Rules são avaliadas em ordem: primeira que bater vence.
 * Types:
 *  - 'channel'    → ativa para lista de channelIds
 *  - 'user'       → ativa para lista de userIds
 *  - 'percentage' → hash estável do targetId → bucket < percentage
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const FeatureFlagSchemaName = 'FeatureFlag';

export type FlagRuleType = 'channel' | 'user' | 'percentage';

export interface FlagRule {
  type: FlagRuleType;
  ids?: string[];
  percentage?: number;
  value: boolean;
}

@Schema({
  collection: 'feature_flags',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class FeatureFlagPersistence {
  @Prop({ type: String, required: true, unique: true, index: true })
  key!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: Boolean, required: true, default: false })
  defaultValue!: boolean;

  @Prop({
    type: [
      {
        type: { type: String, enum: ['channel', 'user', 'percentage'] },
        ids: [String],
        percentage: Number,
        value: Boolean,
      },
    ],
    default: [],
  })
  rules!: FlagRule[];

  @Prop({ type: String })
  updatedBy?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type FeatureFlagDocument = HydratedDocument<FeatureFlagPersistence>;

export const FeatureFlagSchema = SchemaFactory.createForClass(FeatureFlagPersistence);
