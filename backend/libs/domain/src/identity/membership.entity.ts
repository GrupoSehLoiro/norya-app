/**
 * Entidade de domínio: Membership (Identity bounded context).
 *
 * Liga um `User` a um `Workspace` com um **role**. O RBAC mora aqui (não no
 * `User`): o mesmo usuário pode ser `owner` de um workspace e `analyst` de
 * outro. O JWT carrega o role do workspace ativo (`wsRole`). Ver
 * `rbac/role-matrix.md`.
 */
import { DomainError } from '../errors/domain-error';
import { generateId } from '../shared/identity';

export type WsRole = 'owner' | 'admin' | 'manager' | 'analyst' | 'viewer';
export type MembershipStatus = 'active' | 'invited' | 'revoked';

/** Hierarquia de poder (maior = mais poder). Usada pelo guard de role. */
export const WS_ROLE_RANK: Record<WsRole, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  analyst: 2,
  viewer: 1,
};

/** `true` se `role` satisfaz o mínimo exigido (`required`), via hierarquia. */
export function wsRoleSatisfies(role: WsRole, required: WsRole): boolean {
  return WS_ROLE_RANK[role] >= WS_ROLE_RANK[required];
}

export interface MembershipPersistenceShape {
  _id: string;
  workspaceId: string;
  userId: string;
  role: WsRole;
  status: MembershipStatus;
  invitedEmail: string | null;
  createdAt: Date;
}

export class InvalidMembershipError extends DomainError {
  public readonly code = 'INVALID_MEMBERSHIP';
  public readonly statusCode = 422;
}

export class Membership {
  private constructor(
    private readonly id: string,
    private readonly workspaceId: string,
    private readonly userId: string,
    private role: WsRole,
    private status: MembershipStatus,
    private readonly invitedEmail: string | null,
    private readonly createdAt: Date,
  ) {}

  static create(props: {
    workspaceId: string;
    userId: string;
    role: WsRole;
    status?: MembershipStatus;
    invitedEmail?: string | null;
  }): Membership {
    if (!props.workspaceId) {
      throw new InvalidMembershipError('workspaceId é obrigatório');
    }
    if (!props.userId) {
      throw new InvalidMembershipError('userId é obrigatório');
    }
    return new Membership(
      generateId(),
      props.workspaceId,
      props.userId,
      props.role,
      props.status ?? 'active',
      props.invitedEmail ?? null,
      new Date(),
    );
  }

  static reconstitute(props: MembershipPersistenceShape): Membership {
    return new Membership(
      props._id,
      props.workspaceId,
      props.userId,
      props.role,
      props.status,
      props.invitedEmail,
      props.createdAt,
    );
  }

  getId(): string {
    return this.id;
  }
  getWorkspaceId(): string {
    return this.workspaceId;
  }
  getUserId(): string {
    return this.userId;
  }
  getRole(): WsRole {
    return this.role;
  }
  getStatus(): MembershipStatus {
    return this.status;
  }
  isActive(): boolean {
    return this.status === 'active';
  }

  changeRole(role: WsRole): void {
    this.role = role;
  }
  activate(): void {
    this.status = 'active';
  }
  revoke(): void {
    this.status = 'revoked';
  }

  toPersistence(): MembershipPersistenceShape {
    return {
      _id: this.id,
      workspaceId: this.workspaceId,
      userId: this.userId,
      role: this.role,
      status: this.status,
      invitedEmail: this.invitedEmail,
      createdAt: this.createdAt,
    };
  }
}
