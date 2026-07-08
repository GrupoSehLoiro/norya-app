/**
 * Contract (port) do repositório de Membership.
 * Implementação concreta (Mongoose) em `@sehloro/infra`.
 */
import { Membership } from './membership.entity';

export interface MembershipRepository {
  findById(id: string): Promise<Membership | null>;
  /** Membership de um usuário num workspace específico (único). */
  findByUserAndWorkspace(userId: string, workspaceId: string): Promise<Membership | null>;
  /** Todas as memberships do usuário (para listar workspaces). */
  findByUserId(userId: string): Promise<Membership[]>;
  /** Todas as memberships de um workspace (gestão de membros). */
  findByWorkspaceId(workspaceId: string): Promise<Membership[]>;
  save(membership: Membership): Promise<Membership>;
  delete(id: string): Promise<void>;
}

export const MEMBERSHIP_REPOSITORY = Symbol('MembershipRepository');
