/**
 * Schema Mongoose para a collection `messagedeleteds` (legacy).
 *
 * Default Mongoose pluralization: `mongoose.model('MessageDeleted', ...)`
 * → `messagedeleteds`. Mantemos o nome para não quebrar bots.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const MessageDeletedSchemaName = 'MessageDeleted';

@Schema({
  collection: 'messagedeleteds',
  timestamps: false,
})
export class MessageDeletedPersistence {
  @Prop({ type: String, required: true, index: true })
  channel!: string;

  @Prop({ type: String, required: true })
  username!: string;

  // EventSub `channel.chat.message_delete` NÃO traz o corpo da mensagem —
  // só message_id + target user. Logo, deletedMessage pode vir vazio; manter
  // required:true fazia o Mongoose rejeitar string vazia e o handler perdia
  // todo delete real. O texto, quando disponível, é enriquecido upstream.
  @Prop({ type: String, required: false, default: '' })
  deletedMessage!: string;

  @Prop({ type: Date, required: true, index: true })
  timestamp!: Date;
}

export type MessageDeletedDocument = HydratedDocument<MessageDeletedPersistence>;
export const MessageDeletedSchema = SchemaFactory.createForClass(MessageDeletedPersistence);
