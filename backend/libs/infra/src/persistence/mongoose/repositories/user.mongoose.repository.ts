/**
 * Adapter Mongoose para `UserRepository`.
 *
 * `save` é upsert por `_id`. Como o schema declara `_id: String`, aceitamos
 * tanto UUIDs (gerados por `User.create`) quanto strings hex de ObjectId
 * (rehidratadas de documentos legados). Nos dois casos o driver faz match
 * literal em `_id`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserRepository } from '@sehloro/domain';
import { UserPersistence, UserSchemaName } from '../schemas/user.schema';
import { toDomain, toPersistence } from '../mappers/user.mapper';

@Injectable()
export class UserMongooseRepository implements UserRepository {
  constructor(
    @InjectModel(UserSchemaName)
    private readonly model: Model<UserPersistence>,
  ) {}

  async findById(id: string): Promise<User | null> {
    const doc = await this.model.findById(id).exec();
    return doc ? toDomain(doc) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const doc = await this.model.findOne({ username }).exec();
    return doc ? toDomain(doc) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await this.model.findOne({ email }).exec();
    return doc ? toDomain(doc) : null;
  }

  async findAll(limit = 500): Promise<User[]> {
    // Sem timestamps no schema (compat legado) — ordena por email para uma
    // listagem estável no gerenciador de acesso.
    const docs = await this.model.find().sort({ email: 1 }).limit(limit).exec();
    return docs.map(toDomain);
  }

  /**
   * Upsert idempotente. Usa `findOneAndUpdate` com filter `{_id}` +
   * `{upsert: true, new: true, setDefaultsOnInsert: true}`.
   *
   * Por que não `findByIdAndUpdate`? Porque ele invoca cast via `_id` path
   * que, em certas versões do Mongoose, preferencia ObjectId. Usar filter
   * explícito elimina ambiguidade.
   */
  async save(user: User): Promise<User> {
    const payload = toPersistence(user);
    const { _id, ...rest } = payload;

    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!updated) {
      // Mongoose garante `new: true` sempre retorna o doc em upsert.
      // Fallback defensivo: re-lê por id.
      const reread = await this.model.findById(_id).exec();
      if (!reread) {
        throw new Error(`Falha ao persistir User id=${_id}`);
      }
      return toDomain(reread);
    }

    return toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }
}
