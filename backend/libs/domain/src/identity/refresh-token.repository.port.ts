/**
 * Contract (port) do repositório de RefreshToken.
 *
 * Implementação concreta vive em `@sehloro/infra` (Mongoose). Módulos Nest
 * injetam pelo símbolo `REFRESH_TOKEN_REPOSITORY`.
 *
 * Semântica:
 * - `save` é insert puro (refresh tokens são imutáveis depois de emitidos,
 *   exceto pelo campo `revokedAt`). Revogações passam por `revoke`.
 * - `findByTokenHash` é o único caminho de lookup. Não existe endpoint que
 *   liste refresh tokens por usuário para o frontend — o cliente só conhece
 *   o plaintext, e o servidor só conhece o hash.
 * - `revokeAllByUserId` é a chave da detecção de reuse: quando um token já
 *   revogado é apresentado de novo, derrubamos a sessão inteira do usuário.
 */
import { RefreshToken } from './refresh-token.entity';

export interface RefreshTokenRepository {
  save(token: RefreshToken): Promise<RefreshToken>;
  findByTokenHash(hash: string): Promise<RefreshToken | null>;
  /**
   * Marca um refresh token como revogado (idempotente — revogar um token já
   * revogado é no-op). `reason` é opcional, só usado para logs no service.
   */
  revoke(id: string, reason?: string): Promise<void>;
  /**
   * Revoga todos os refresh tokens (ativos ou não) pertencentes a um usuário.
   * Dispara em detecção de reuse para invalidar a sessão inteira.
   */
  revokeAllByUserId(userId: string): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('RefreshTokenRepository');
