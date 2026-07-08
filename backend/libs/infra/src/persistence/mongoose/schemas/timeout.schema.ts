/**
 * Schema Mongoose para a collection `timeouts` (legacy).
 *
 * Escrita pelos bots via `mongoose.model('Timeout', ...)` e pelo SLMOD-api
 * legado via `mongoose.model('timeout', ...)`. Ambos resolvem para a mesma
 * collection `timeouts`. Campos preservados sem renomear.
 *
 * `tempoDeTO` é pt-BR intencional (ver CLAUDE.md: identificadores pt-BR).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const TimeoutSchemaName = 'Timeout';

@Schema({
  collection: 'timeouts',
  timestamps: false,
})
export class TimeoutPersistence {
  @Prop({ type: String, required: true, index: true })
  channel!: string;

  @Prop({ type: String, required: true })
  userName!: string;

  // reason/modName podem vir vazios do EventSub — não bloquear o registro.
  @Prop({ type: String, required: false, default: '' })
  reason!: string;

  @Prop({ type: Number, required: true })
  tempoDeTO!: number;

  @Prop({ type: Date, required: true, index: true })
  timestamp!: Date;

  @Prop({ type: String, required: false, default: '' })
  modName!: string;
}

export type TimeoutDocument = HydratedDocument<TimeoutPersistence>;
export const TimeoutSchema = SchemaFactory.createForClass(TimeoutPersistence);
