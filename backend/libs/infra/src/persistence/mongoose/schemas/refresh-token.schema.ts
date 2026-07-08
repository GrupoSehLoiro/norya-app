/**
 * Schema Mongoose para a collection `refresh_tokens` (database `sehloirostudios`).
 *
 * Esta coleção é NOVA (não existe no legado Express). Nomes de campos seguem
 * camelCase do domínio NestJS — não precisamos emular nenhum contrato antigo.
 *
 * Armazenamos apenas o SHA-256 do refresh token; o plaintext sai da API
 * uma única vez no momento da emissão e nunca é persistido. Por isso o index
 * em `tokenHash` é unique — colisão de SHA-256 é impossível na prática, mas
 * também protege contra dupla-inserção de um mesmo token.
 *
 * Sobre `expires` TTL: deixamos o Mongo colecionar o lixo de tokens expirados
 * automaticamente. O service ainda precisa checar `expiresAt` no refresh()
 * porque TTL do Mongo só roda a cada 60s e não queremos aceitar um token
 * que acabou de expirar.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const RefreshTokenSchemaName = 'RefreshToken';

@Schema({
  collection: 'refresh_tokens',
  _id: false,
})
export class RefreshTokenPersistence {
  @Prop({ type: String })
  _id!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  /** Id do refresh anterior na cadeia de rotação. `null` para o primeiro. */
  @Prop({ type: String, default: null })
  rotatedFromId!: string | null;
}

export type RefreshTokenDocument = HydratedDocument<RefreshTokenPersistence>;

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshTokenPersistence);

// TTL index — MongoDB remove documentos automaticamente depois de expiresAt.
// `expireAfterSeconds: 0` significa "use a data literal do campo como prazo".
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
