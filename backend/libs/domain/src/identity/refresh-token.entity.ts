/**
 * Entidade de domínio: RefreshToken (Identity bounded context).
 *
 * Regras:
 * - O plaintext do refresh token NUNCA vive nesta entidade. Armazenamos
 *   apenas o SHA-256 do valor emitido ao cliente. O plaintext só transita
 *   na resposta HTTP no momento da emissão e, depois disso, é sempre
 *   recalculado via hash antes de bater no repositório.
 * - `rotatedFromId` aponta para o refresh anterior na cadeia de rotação.
 *   Usamos para forensics e para invalidar a cadeia inteira quando
 *   detectamos reuse de um token já revogado.
 * - Sem `validatePassword` — não é credencial comparável; é uma chave
 *   opaca que só serve para lookup direto.
 *
 * Rehidratação via `reconstitute`. Criação via `create` (gera UUID).
 */
import { generateId } from '../shared/identity';

export interface RefreshTokenPersistenceShape {
  _id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  rotatedFromId: string | null;
}

export class RefreshToken {
  private constructor(
    private readonly id: string,
    private readonly userId: string,
    private readonly tokenHash: string,
    private readonly expiresAt: Date,
    private readonly createdAt: Date,
    private revokedAt: Date | null,
    private readonly rotatedFromId: string | null,
  ) {}

  static create(props: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedFromId?: string | null;
  }): RefreshToken {
    return new RefreshToken(
      generateId(),
      props.userId,
      props.tokenHash,
      props.expiresAt,
      new Date(),
      null,
      props.rotatedFromId ?? null,
    );
  }

  static reconstitute(props: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    revokedAt: Date | null;
    rotatedFromId: string | null;
  }): RefreshToken {
    return new RefreshToken(
      props.id,
      props.userId,
      props.tokenHash,
      props.expiresAt,
      props.createdAt,
      props.revokedAt,
      props.rotatedFromId,
    );
  }

  getId(): string {
    return this.id;
  }

  getUserId(): string {
    return this.userId;
  }

  getTokenHash(): string {
    return this.tokenHash;
  }

  getExpiresAt(): Date {
    return this.expiresAt;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getRevokedAt(): Date | null {
    return this.revokedAt;
  }

  getRotatedFromId(): string | null {
    return this.rotatedFromId;
  }

  isRevoked(): boolean {
    return this.revokedAt !== null;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Marca como revogado. O repositório persiste o novo `revokedAt`
   * via `revoke(id)`. Expor um setter aqui mantém o invariante
   * (uma vez revogado, sempre revogado) dentro da própria entidade.
   */
  revoke(at: Date = new Date()): void {
    if (this.revokedAt === null) {
      this.revokedAt = at;
    }
  }

  toPersistence(): RefreshTokenPersistenceShape {
    return {
      _id: this.id,
      userId: this.userId,
      tokenHash: this.tokenHash,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      revokedAt: this.revokedAt,
      rotatedFromId: this.rotatedFromId,
    };
  }
}
