/**
 * MON-01 · Schema Mongoose para LiveSession.
 *
 * Índice parcial {channelId, state} com partialFilter state=ACTIVE garante
 * que não existam duas sessões ACTIVE para o mesmo canal simultaneamente
 * (constraint de banco complementa a invariante do domínio).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const LiveSessionSchemaName = 'LiveSession';

@Schema({
  collection: 'live_sessions',
  _id: false,
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class LiveSessionPersistence {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true, index: true })
  channelId!: string;

  @Prop({ type: String, enum: ['twitch', 'kick'], required: true })
  platform!: string;

  @Prop({
    type: String,
    enum: ['SCHEDULED', 'ACTIVE', 'ENDED'],
    required: true,
    default: 'SCHEDULED',
  })
  state!: string;

  @Prop({ type: String })
  title?: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  endedAt?: Date;

  @Prop({ type: Number })
  peakViewerCount?: number;

  @Prop({ type: Number })
  avgViewerCount?: number;

  @Prop({ type: Number, default: 0 })
  totalMessages!: number;

  @Prop({ type: String })
  summary?: string;

  @Prop({ type: Boolean, default: false })
  autoStarted!: boolean;

  @Prop({ type: Date })
  lastEventAt?: Date;

  createdAt?: Date;
}

export type LiveSessionDocument = HydratedDocument<LiveSessionPersistence>;

export const LiveSessionSchema = SchemaFactory.createForClass(LiveSessionPersistence);

// Garante máximo 1 sessão ACTIVE por canal
LiveSessionSchema.index(
  { channelId: 1 },
  { unique: true, partialFilterExpression: { state: 'ACTIVE' } },
);
