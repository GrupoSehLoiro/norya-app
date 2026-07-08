/**
 * Adapter Mongoose para `RefreshTokenRepository`.
 *
 * Diferente do UserRepository, `save` aqui é um insert genuíno — refresh
 * tokens não são atualizados no caminho principal (só revogados via `revoke`).
 * Ainda usamos upsert para manter a API idempotente caso o mesmo id apareça
 * duas vezes (ex.: retry depois de crash do Node antes do ack).
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RefreshToken, RefreshTokenRepository } from '@sehloro/domain';
import {
  RefreshTokenDocument,
  RefreshTokenPersistence,
  RefreshTokenSchemaName,
} from '../schemas/refresh-token.schema';

@Injectable()
export class RefreshTokenMongooseRepository implements RefreshTokenRepository {
  constructor(
    @InjectModel(RefreshTokenSchemaName)
    private readonly model: Model<RefreshTokenPersistence>,
  ) {}

  async save(token: RefreshToken): Promise<RefreshToken> {
    const payload = token.toPersistence();
    const { _id, ...rest } = payload;

    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) {
        throw new Error(`Falha ao persistir RefreshToken id=${_id}`);
      }
      return this.toDomain(reread);
    }

    return this.toDomain(updated);
  }

  async findByTokenHash(hash: string): Promise<RefreshToken | null> {
    const doc = await this.model.findOne({ tokenHash: hash }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async revoke(id: string, _reason?: string): Promise<void> {
    // `_reason` chega aqui só para satisfazer a interface — por ora não
    // persistimos em campo dedicado. Se o AUTH-03 exigir auditoria, adicione
    // um `revokedReason` ao schema e grave aqui.
    await this.model
      .updateOne({ _id: id, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  async revokeAllByUserId(userId: string): Promise<void> {
    await this.model
      .updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  /**
   * Mapper inline — trivial o bastante para não justificar um arquivo separado
   * como acontece com User/Channel (que têm tratamento de role default, etc.).
   */
  private toDomain(doc: RefreshTokenDocument): RefreshToken {
    return RefreshToken.reconstitute({
      id: String(doc._id),
      userId: doc.userId,
      tokenHash: doc.tokenHash,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
      revokedAt: doc.revokedAt ?? null,
      rotatedFromId: doc.rotatedFromId ?? null,
    });
  }
}
