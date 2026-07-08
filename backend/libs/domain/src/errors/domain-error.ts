/**
 * Classe base para erros originados na camada de domínio.
 *
 * Diferente de `HttpException` (framework-bound), `DomainError` é plain TS —
 * pode ser lançado por serviços de domínio sem criar dependência do Nest.
 * O `AllExceptionsFilter` mapeia `DomainError` para a resposta HTTP final
 * preservando o `code` (machine-readable) e o `statusCode` sugerido.
 *
 * Subclasses concretas (ex.: ChannelNotFoundError, ForbiddenActionError) vão
 * ser adicionadas pelos bounded contexts conforme a modelagem avança.
 */
export abstract class DomainError extends Error {
  /** Código estável consumido pelo frontend para i18n e lógica de retry. */
  public abstract readonly code: string;

  /** Status HTTP sugerido. O filter usa este valor como default. */
  public abstract readonly statusCode: number;

  /** Payload extra opcional para o client (sem vazar PII). */
  public readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    // Preserva o stack trace no V8
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Type guard útil no filter e em testes.
 */
export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
