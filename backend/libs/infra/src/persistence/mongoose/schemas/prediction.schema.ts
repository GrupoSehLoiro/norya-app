/**
 * Schema Mongoose para a collection `predictions` (legacy).
 *
 * Cada documento é uma prediction da Twitch (channel.prediction.end via
 * EventSub no bot). Campos preservados conforme `SLMOD-api/api/models/prediction.model.js`.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const PredictionSchemaName = 'Prediction';

class PredictionTopBetter {
  @Prop({ type: String })
  userName!: string;

  @Prop({ type: Number })
  amount!: number;
}

class PredictionOption {
  @Prop({ type: String })
  title!: string;

  @Prop({ type: Number })
  totalBetAmount!: number;

  @Prop({ type: String })
  id!: string;

  @Prop({ type: Number })
  users!: number;

  @Prop({ type: [PredictionTopBetter], default: [] })
  topBetters!: PredictionTopBetter[];
}

@Schema({
  collection: 'predictions',
  timestamps: false,
})
export class PredictionPersistence {
  @Prop({ type: String })
  predictionId?: string;

  @Prop({ type: String, index: true })
  channel?: string;

  @Prop({ type: String })
  title?: string;

  @Prop({ type: String })
  winningOutcome?: string;

  @Prop({ type: Date, index: true })
  created_at?: Date;

  @Prop({ type: Date })
  ended_at?: Date;

  @Prop({ type: Date })
  locked_at?: Date;

  @Prop({ type: [PredictionOption], default: [] })
  options!: PredictionOption[];
}

export type PredictionDocument = HydratedDocument<PredictionPersistence>;
export const PredictionSchema = SchemaFactory.createForClass(PredictionPersistence);
