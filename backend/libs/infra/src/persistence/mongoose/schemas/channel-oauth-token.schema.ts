/**
 * Schema Mongoose para a collection `channel_oauth_tokens`.
 *
 * Diferente de `users` e `channels` (que existem no Mongo legado e
 * precisam usar nomes de campo legados), esta collection é NOVA — criada
 * no AUTH-02 para consolidar os tokens OAuth que antes viviam em `.env`
 * dos bots. Nomes de campo são camelCase alinhados ao domínio.
 *
 * ENCRYPTION-AT-REST
 * ==================
 * `accessToken` e `refreshToken` são marcados com `@EncryptedField()`. O
 * plugin `createEncryptionPlugin(cryptoService)` — registrado no bootstrap
 * do `PersistenceModule` via `MongooseModule.forFeatureAsync` — intercepta
 * save/init/update e converte plaintext <-> `v1:<base64>` transparentemente.
 *
 * Por que o plugin NÃO é aplicado aqui diretamente:
 *   - O `CryptoService` é injetado pelo DI do Nest. Este arquivo é um
 *     módulo estático de schema — não tem acesso ao DI. O wiring acontece
 *     em `persistence.module.ts`.
 *
 * COMPOUND INDEX
 * ==============
 * Unique em `{channelId, platform}` — um canal só pode ter um token por
 * plataforma. Refresh de token é upsert pela mesma chave composta.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EncryptedField } from '../../../crypto/encrypted-field.decorator';

export const ChannelOAuthTokenSchemaName = 'ChannelOAuthToken';

@Schema({
  collection: 'channel_oauth_tokens',
  _id: false,
  // `updatedAt` só — `createdAt` não faz sentido para upserts de token que
  // trocam constantemente. Controlamos o valor via entidade de domínio.
  timestamps: { createdAt: false, updatedAt: 'updatedAt' },
})
export class ChannelOAuthTokenPersistence {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true, index: true })
  channelId!: string;

  @Prop({ type: String, required: true, enum: ['twitch', 'kick'] })
  platform!: string;

  @EncryptedField()
  @Prop({ type: String, required: true })
  accessToken!: string;

  @EncryptedField()
  @Prop({ type: String, required: true })
  refreshToken!: string;

  @Prop({ type: String, default: '' })
  scope!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type ChannelOAuthTokenDocument = HydratedDocument<ChannelOAuthTokenPersistence>;

export const ChannelOAuthTokenSchema = SchemaFactory.createForClass(ChannelOAuthTokenPersistence);

// Compound index unique: 1 token OAuth por canal por plataforma.
ChannelOAuthTokenSchema.index({ channelId: 1, platform: 1 }, { unique: true });
