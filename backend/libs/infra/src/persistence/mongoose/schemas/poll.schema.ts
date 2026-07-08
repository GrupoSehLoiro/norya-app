/**
 * Schema Mongoose para a collection `polls` (legacy).
 *
 * Nenhum bot em `Bots/` escreve diretamente — coleção provavelmente populada
 * por bot legado descontinuado. Esquema mantido p/ ler dados históricos.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const PollSchemaName = 'Poll';

class PollChoice {
  @Prop({ type: String })
  id!: string;

  @Prop({ type: String })
  title!: string;

  @Prop({ type: Number })
  votes!: number;

  @Prop({ type: Number })
  channel_points_votes!: number;

  @Prop({ type: Number })
  bits_votes!: number;
}

@Schema({
  collection: 'polls',
  timestamps: false,
})
export class PollPersistence {
  @Prop({ type: String })
  pollId?: string;

  @Prop({ type: String, index: true })
  channel?: string;

  @Prop({ type: String })
  title?: string;

  @Prop({ type: Date, index: true })
  created_at?: Date;

  @Prop({ type: Date })
  ended_at?: Date;

  @Prop({ type: Number })
  duration?: number;

  @Prop({ type: [PollChoice], default: [] })
  choices!: PollChoice[];

  @Prop({ type: Boolean })
  bits_voting_enabled?: boolean;

  @Prop({ type: Number })
  bits_per_vote?: number;

  @Prop({ type: Boolean })
  channel_points_voting_enabled?: boolean;

  @Prop({ type: Number })
  channel_points_per_vote?: number;
}

export type PollDocument = HydratedDocument<PollPersistence>;
export const PollSchema = SchemaFactory.createForClass(PollPersistence);
