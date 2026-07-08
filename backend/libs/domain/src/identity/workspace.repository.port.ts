/**
 * Contract (port) do repositório de Workspace.
 * Implementação concreta (Mongoose) em `@sehloro/infra`. Injetar pelo símbolo.
 */
import { Workspace } from './workspace.entity';

export interface WorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  findBySlug(slug: string): Promise<Workspace | null>;
  /** Todos os workspaces de que o usuário é dono (atalho; membership é a fonte real). */
  findByOwnerUserId(ownerUserId: string): Promise<Workspace[]>;
  save(workspace: Workspace): Promise<Workspace>;
  delete(id: string): Promise<void>;
}

export const WORKSPACE_REPOSITORY = Symbol('WorkspaceRepository');
