/**
 * Contract (port) do repositório de EmailVerificationCode.
 * Implementação concreta (Mongoose) em `@sehloro/infra`.
 */
import { EmailVerificationCode } from './email-verification-code.entity';

export interface EmailVerificationCodeRepository {
  save(code: EmailVerificationCode): Promise<EmailVerificationCode>;
  /** Código ativo (não consumido) mais recente para um email. */
  findLatestActiveByEmail(email: string): Promise<EmailVerificationCode | null>;
  /** Invalida (consome) todos os códigos ativos de um email — usado em reenvio. */
  invalidateAllForEmail(email: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export const EMAIL_VERIFICATION_CODE_REPOSITORY = Symbol('EmailVerificationCodeRepository');
