/**
 * Entidade de domínio: EmailVerificationCode (Identity bounded context).
 *
 * Código OTP de 6 dígitos enviado por email no sign-up (verificação 1x). O
 * plaintext NUNCA vive aqui — guardamos só o SHA-256 (`codeHash`), mesmo padrão
 * de RefreshToken. Tem expiração curta e limite de tentativas (anti brute-force).
 *
 * A geração do código (6 dígitos) e o hashing vivem na camada de aplicação
 * (AuthService) — a entidade só guarda o hash e gerencia o ciclo de vida.
 */
import { generateId } from '../shared/identity';

export interface EmailVerificationCodePersistenceShape {
  _id: string;
  userId: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export class EmailVerificationCode {
  private constructor(
    private readonly id: string,
    private readonly userId: string,
    private readonly email: string,
    private readonly codeHash: string,
    private readonly expiresAt: Date,
    private consumedAt: Date | null,
    private attempts: number,
    private readonly createdAt: Date,
  ) {}

  static create(props: {
    userId: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
  }): EmailVerificationCode {
    return new EmailVerificationCode(
      generateId(),
      props.userId,
      props.email,
      props.codeHash,
      props.expiresAt,
      null,
      0,
      new Date(),
    );
  }

  static reconstitute(props: EmailVerificationCodePersistenceShape): EmailVerificationCode {
    return new EmailVerificationCode(
      props._id,
      props.userId,
      props.email,
      props.codeHash,
      props.expiresAt,
      props.consumedAt,
      props.attempts,
      props.createdAt,
    );
  }

  getId(): string {
    return this.id;
  }
  getUserId(): string {
    return this.userId;
  }
  getEmail(): string {
    return this.email;
  }
  getCodeHash(): string {
    return this.codeHash;
  }
  getAttempts(): number {
    return this.attempts;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }
  isConsumed(): boolean {
    return this.consumedAt !== null;
  }
  /** `true` se ainda pode tentar (abaixo do máximo). */
  canAttempt(maxAttempts: number): boolean {
    return this.attempts < maxAttempts;
  }

  registerAttempt(): void {
    this.attempts += 1;
  }
  consume(at: Date = new Date()): void {
    if (this.consumedAt === null) {
      this.consumedAt = at;
    }
  }

  toPersistence(): EmailVerificationCodePersistenceShape {
    return {
      _id: this.id,
      userId: this.userId,
      email: this.email,
      codeHash: this.codeHash,
      expiresAt: this.expiresAt,
      consumedAt: this.consumedAt,
      attempts: this.attempts,
      createdAt: this.createdAt,
    };
  }
}
