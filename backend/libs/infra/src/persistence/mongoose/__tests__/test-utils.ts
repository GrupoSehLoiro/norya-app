/**
 * Utilidades de teste para os adapters Mongoose.
 *
 * Sobe um `mongodb-memory-server` isolado por test file, conecta com
 * `mongoose.createConnection` e expõe os Models compilados a partir dos
 * schemas de produção — garantindo que o teste exercita EXATAMENTE os
 * mesmos schemas que vão pra produção.
 *
 * AUTH-02: também sabemos montar o model de `ChannelOAuthToken` com o
 * plugin de encryption injetado a partir de uma instância real (ou mock)
 * de `CryptoService`. Por isso `startTestMongo` aceita um argumento
 * opcional `encryption` — passando-o, o model exposto em
 * `handle.channelOAuthTokenModel` terá o plugin ativo.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Schema } from 'mongoose';
import { UserSchema, UserSchemaName, UserPersistence } from '../schemas/user.schema';
import { ChannelSchema, ChannelSchemaName, ChannelPersistence } from '../schemas/channel.schema';
import {
  ChannelOAuthTokenSchema,
  ChannelOAuthTokenSchemaName,
  ChannelOAuthTokenPersistence,
} from '../schemas/channel-oauth-token.schema';
import { CryptoService } from '../../../crypto/crypto.service';
import { createEncryptionPlugin } from '../../../crypto/mongoose-encryption.plugin';
import { getEncryptedFields } from '../../../crypto/encrypted-field.decorator';

export interface TestMongoHandle {
  server: MongoMemoryServer;
  connection: Connection;
  userModel: Model<UserPersistence>;
  channelModel: Model<ChannelPersistence>;
  channelOAuthTokenModel: Model<ChannelOAuthTokenPersistence>;
  close: () => Promise<void>;
}

export interface StartTestMongoOptions {
  /**
   * Se passado, o schema `ChannelOAuthToken` recebe o plugin de encryption
   * usando essa instância de `CryptoService`. Sem isso, os campos são
   * persistidos em plaintext — útil para testar cenários de migração.
   */
  encryption?: CryptoService;
}

export async function startTestMongo(
  options: StartTestMongoOptions = {},
): Promise<TestMongoHandle> {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  const connection = await mongoose.createConnection(uri).asPromise();

  const userModel = connection.model<UserPersistence>(UserSchemaName, UserSchema);
  const channelModel = connection.model<ChannelPersistence>(ChannelSchemaName, ChannelSchema);

  // Clonamos o schema para evitar que plugins aplicados em um teste
  // "vazem" para outros test files que compartilham o import estático
  // `ChannelOAuthTokenSchema`. Mongoose não expõe um `.clone()` canônico,
  // então reconstruímos via definition + options.
  const tokenSchema = cloneSchema(ChannelOAuthTokenSchema);
  if (options.encryption) {
    const fields = getEncryptedFields(ChannelOAuthTokenPersistence);
    tokenSchema.plugin(createEncryptionPlugin(options.encryption), { fields });
  }
  const channelOAuthTokenModel = connection.model<ChannelOAuthTokenPersistence>(
    ChannelOAuthTokenSchemaName,
    tokenSchema,
  );

  return {
    server,
    connection,
    userModel,
    channelModel,
    channelOAuthTokenModel,
    close: async () => {
      await connection.close();
      await server.stop();
    },
  };
}

/**
 * Helper simples para "clonar" um Schema Mongoose: copia os paths e
 * options. Suficiente para nossos testes — não cobre sub-schemas
 * aninhados. Mongoose 8.x expõe `Schema.prototype.clone()`; usamos ele
 * quando disponível, com fallback manual.
 */
function cloneSchema<T>(src: Schema<T>): Schema<T> {
  const maybeClone = (src as unknown as { clone?: () => Schema<T> }).clone;
  if (typeof maybeClone === 'function') {
    return maybeClone.call(src);
  }
  return src;
}
