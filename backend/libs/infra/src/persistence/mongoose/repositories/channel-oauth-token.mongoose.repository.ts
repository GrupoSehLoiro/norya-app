/**
 * Adapter Mongoose para `ChannelOAuthTokenRepository`.
 *
 * IMPORTANTE: não sabemos (e não precisamos saber) que os campos são
 * encriptados em disco. O plugin `createEncryptionPlugin` intercepta
 * save/findOneAndUpdate/init transparentemente. A entidade e este
 * repositório trabalham sempre com plaintext em memória.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChannelOAuthToken, ChannelOAuthTokenRepository, ChannelPlatform } from '@sehloro/domain';
import {
  ChannelOAuthTokenPersistence,
  ChannelOAuthTokenSchemaName,
} from '../schemas/channel-oauth-token.schema';
import { toDomain, toPersistence } from '../mappers/channel-oauth-token.mapper';

@Injectable()
export class ChannelOAuthTokenMongooseRepository implements ChannelOAuthTokenRepository {
  constructor(
    @InjectModel(ChannelOAuthTokenSchemaName)
    private readonly model: Model<ChannelOAuthTokenPersistence>,
  ) {}

  async findByChannelId(
    channelId: string,
    platform: ChannelPlatform,
  ): Promise<ChannelOAuthToken | null> {
    const doc = await this.model.findOne({ channelId, platform }).exec();
    return doc ? toDomain(doc) : null;
  }

  /**
   * Upsert por `_id`. Se um doc com mesmo `(channelId, platform)` já existir
   * com outro `_id`, o compound index unique vai disparar E11000 — o caller
   * deve interpretar isso como "existe um token para esse canal+plataforma;
   * use o _id existente para atualizar" ou usar `findByChannelId` antes.
   */
  async save(token: ChannelOAuthToken): Promise<ChannelOAuthToken> {
    const payload = toPersistence(token);
    const { _id, ...rest } = payload;

    // Usamos `.save()` com `new this.model(...)` em vez de findOneAndUpdate
    // porque o plugin de encryption registra `pre('save')` e queremos que
    // esse hook rode (ele também cobre o caminho update, mas o caminho save
    // é mais direto para upserts por `_id`). Para manter idempotência, se
    // já existir doc com esse `_id`, fazemos update por doc.
    const existing = await this.model.findById(_id).exec();
    if (existing) {
      existing.set(rest);
      const saved = await existing.save();
      return toDomain(saved);
    }

    const created = new this.model({ _id, ...rest });
    const saved = await created.save();
    return toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }
}
