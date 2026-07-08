/**
 * Schema Mongoose para a collection `email_verification_codes`.
 *
 * Guardamos só o SHA-256 do código (`codeHash`); o plaintext (6 dígitos) só
 * transita no email. TTL automático em `expiresAt` (o service ainda checa a
 * expiração porque o TTL do Mongo roda só a cada ~60s). Collection nova.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const EmailVerificationCodeSchemaName = 'EmailVerificationCode';

@Schema({ collection: 'email_verification_codes', _id: false })
export class EmailVerificationCodePersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, index: true })
  email!: string;

  @Prop({ type: String, required: true })
  codeHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;

  @Prop({ type: Number, default: 0, required: true })
  attempts!: number;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;
}

export type EmailVerificationCodeDocument = HydratedDocument<EmailVerificationCodePersistence>;
export const EmailVerificationCodeSchema = SchemaFactory.createForClass(
  EmailVerificationCodePersistence,
);

// TTL — Mongo remove códigos expirados automaticamente.
EmailVerificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
