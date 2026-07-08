/**
 * Schema Mongoose para a collection `emojis` (legacy).
 *
 * Bot_SocialListening grava emojis amostrados do chat usando
 * `mongoose.model('Emoji', emojiSchema)`. SLMOD-api lê via
 * `mongoose.model('emoji', ...)` — mesmo collection (mongoose lowercases
 * antes de pluralizar).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const ChatEmojiSchemaName = 'ChatEmoji';

@Schema({
  collection: 'emojis',
  timestamps: false,
})
export class ChatEmojiPersistence {
  @Prop({ type: String, index: true })
  channel?: string;

  @Prop({ type: String })
  username?: string;

  @Prop({ type: String })
  message?: string;

  @Prop({ type: String })
  emoji?: string;

  @Prop({ type: Date, index: true })
  timestamp?: Date;
}

export type ChatEmojiDocument = HydratedDocument<ChatEmojiPersistence>;
export const ChatEmojiSchema = SchemaFactory.createForClass(ChatEmojiPersistence);
