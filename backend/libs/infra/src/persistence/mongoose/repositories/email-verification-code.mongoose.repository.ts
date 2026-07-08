/**
 * Adapter Mongoose para `EmailVerificationCodeRepository`.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailVerificationCode, EmailVerificationCodeRepository } from '@sehloro/domain';
import {
  EmailVerificationCodeDocument,
  EmailVerificationCodePersistence,
  EmailVerificationCodeSchemaName,
} from '../schemas/email-verification-code.schema';

@Injectable()
export class EmailVerificationCodeMongooseRepository implements EmailVerificationCodeRepository {
  constructor(
    @InjectModel(EmailVerificationCodeSchemaName)
    private readonly model: Model<EmailVerificationCodePersistence>,
  ) {}

  async save(code: EmailVerificationCode): Promise<EmailVerificationCode> {
    const { _id, ...rest } = code.toPersistence();
    const updated = await this.model
      .findOneAndUpdate(
        { _id },
        { $set: rest, $setOnInsert: { _id } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!updated) {
      const reread = await this.model.findById(_id).exec();
      if (!reread) throw new Error(`Falha ao persistir EmailVerificationCode id=${_id}`);
      return this.toDomain(reread);
    }
    return this.toDomain(updated);
  }

  async findLatestActiveByEmail(email: string): Promise<EmailVerificationCode | null> {
    const doc = await this.model
      .findOne({ email, consumedAt: null })
      .sort({ createdAt: -1 })
      .exec();
    return doc ? this.toDomain(doc) : null;
  }

  async invalidateAllForEmail(email: string): Promise<void> {
    await this.model
      .updateMany({ email, consumedAt: null }, { $set: { consumedAt: new Date() } })
      .exec();
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }

  private toDomain(doc: EmailVerificationCodeDocument): EmailVerificationCode {
    return EmailVerificationCode.reconstitute({
      _id: String(doc._id),
      userId: doc.userId,
      email: doc.email,
      codeHash: doc.codeHash,
      expiresAt: doc.expiresAt,
      consumedAt: doc.consumedAt ?? null,
      attempts: doc.attempts ?? 0,
      createdAt: doc.createdAt,
    });
  }
}
