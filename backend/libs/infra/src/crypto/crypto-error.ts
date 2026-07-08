/**
 * Erro específico da camada de criptografia.
 *
 * NÃO estende DomainError — criptografia é preocupação de infraestrutura,
 * não de domínio. O filter global pode mapear para 500 genérico; nunca
 * devolvemos o `message` cru para o cliente (pode vazar sinais sobre
 * formato interno do ciphertext).
 */
export class CryptoError extends Error {
  public readonly code = 'CRYPTO_ERROR';

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CryptoError';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
