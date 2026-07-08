/**
 * Contract (port) do repositório de Creator.
 * Implementação concreta (Mongoose) em `@sehloro/infra`.
 */
import { Creator } from './creator.entity';

export interface CreatorRepository {
  findById(id: string): Promise<Creator | null>;
  findByWorkspaceId(workspaceId: string): Promise<Creator[]>;
  countByWorkspaceId(workspaceId: string): Promise<number>;
  save(creator: Creator): Promise<Creator>;
  delete(id: string): Promise<void>;
}

export const CREATOR_REPOSITORY = Symbol('CreatorRepository');
