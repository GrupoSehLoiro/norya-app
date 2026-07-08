/**
 * Port (DDD) — implementação concreta vive em @sehloro/infra
 * (Redis adapter). Tests podem mockar usando InMemoryCopypastaDedupService.
 */
import type { RawMessage } from '../ingestion/raw-message';
import type { DedupResult } from './types';

export interface CopypastaDedup {
  /**
   * Processa um batch de msgs. Mantém só a primeira ocorrência por hash
   * de texto normalizado (TTL persistente em Redis no adapter). Retorna
   * groups com o COUNT real (inclusive reaparições dentro do TTL).
   */
  process(msgs: ReadonlyArray<RawMessage>): Promise<DedupResult>;
}

export const COPYPASTA_DEDUP_TOKEN = Symbol('COPYPASTA_DEDUP');
