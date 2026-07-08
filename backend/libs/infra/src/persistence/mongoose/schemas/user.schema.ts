/**
 * Schema Mongoose para a collection `users` (database `sehloirostudios`).
 *
 * Os nomes dos campos são IDÊNTICOS aos do schema legado em
 * `SLMOD-api/api/models/user.model.js`:
 *   - `username` (unique, required)
 *   - `password` (required)  <-- no domínio isto é `passwordHash`
 *   - `email` (required)
 *   - `role` (default 'user')
 *
 * NÃO adicionamos `timestamps: true` — o legado não tem, e adicionar agora
 * criaria divergência entre docs escritos por bots legados e pelo backend novo.
 *
 * Sobre `_id`:
 * - Declaramos `_id: String` no schema para que UUIDs gerados pelo domínio
 *   (`User.create`) sejam aceitos sem cast. Documentos legados com ObjectId
 *   ainda são lidos normalmente — o Mongoose faz `String(objectId)` e o
 *   mapper repassa como `id` string.
 * - O campo é declarado via options do `@Schema()` ao invés de `@Prop()`
 *   porque `_id` é especial no Mongoose.
 *
 * O modelName 'User' preserva compat com `mongoose.model('User', ...)`
 * do legado (collection derivada: `users`).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const UserSchemaName = 'User';

@Schema({
  collection: 'users',
  _id: false,
})
export class UserPersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true, unique: true })
  username!: string;

  /** Campo legado: hash bcrypt da senha. No domínio o nome é `passwordHash`. */
  @Prop({ type: String, required: true })
  password!: string;

  @Prop({ type: String, required: true })
  email!: string;

  @Prop({ type: String, default: 'user' })
  role!: string;

  // ── Campos novos (fluxo de sign-up / onboarding) — todos OPCIONAIS para não
  //    impactar docs escritos pelos bots / SLMOD-api legado. ──

  /** 'pending_email' | 'active' | 'disabled'. Ausente em docs legados = active. */
  @Prop({ type: String })
  status?: string;

  @Prop({ type: Date, default: null })
  emailVerifiedAt?: Date | null;

  @Prop({ type: Date, default: null })
  onboardingCompletedAt?: Date | null;

  @Prop({ type: String, default: null })
  displayName?: string | null;

  @Prop({ type: String, default: null })
  avatarUrl?: string | null;

  @Prop({ type: String, default: null })
  locale?: string | null;
}

export type UserDocument = HydratedDocument<UserPersistence>;

export const UserSchema = SchemaFactory.createForClass(UserPersistence);
