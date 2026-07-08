/**
 * Entidade de domínio: Workspace (Identity bounded context).
 *
 * O Workspace é o **tenant** e a **entidade de cobrança** da plataforma. Tudo
 * (creators, integrações, marcas, insights) é escopado por `workspaceId`. A
 * `Subscription` é embutida aqui (planKey + status) — ver `rbac/` e
 * `identity/billing/plans.ts`.
 *
 * Pura TypeScript. `create` gera UUID; `reconstitute` rehidrata do banco.
 */
import { DomainError } from '../errors/domain-error';
import { DocumentType, isValidDocument, onlyDigits } from '../shared/br-document';
import { generateId } from '../shared/identity';
import { slugify } from '../shared/slug';
import { DEFAULT_PLAN_KEY, PlanKey } from './billing/plans';

export type WorkspaceType = 'creator' | 'agency' | 'brand';
export type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'past_due';

export interface WorkspacePersistenceShape {
  _id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  ownerUserId: string;
  planKey: PlanKey;
  subscriptionStatus: SubscriptionStatus;
  subscriptionStartedAt: Date;
  createdAt: Date;
  /** Documento fiscal (só dígitos) + tipo. Opcional (contas legadas não têm). */
  document: string | null;
  documentType: DocumentType | null;
}

export class InvalidWorkspaceError extends DomainError {
  public readonly code = 'INVALID_WORKSPACE';
  public readonly statusCode = 422;
}

export class Workspace {
  private constructor(
    private readonly id: string,
    private name: string,
    private slug: string,
    private readonly type: WorkspaceType,
    private readonly ownerUserId: string,
    private planKey: PlanKey,
    private subscriptionStatus: SubscriptionStatus,
    private readonly subscriptionStartedAt: Date,
    private readonly createdAt: Date,
    private readonly document: string | null,
    private readonly documentType: DocumentType | null,
  ) {}

  static create(props: {
    name: string;
    ownerUserId: string;
    type?: WorkspaceType;
    slug?: string;
    planKey?: PlanKey;
    document?: string | null;
    documentType?: DocumentType | null;
  }): Workspace {
    if (!props.name || props.name.trim().length === 0) {
      throw new InvalidWorkspaceError('name não pode ser vazio');
    }
    if (!props.ownerUserId) {
      throw new InvalidWorkspaceError('ownerUserId é obrigatório');
    }

    // Documento é opcional, mas se vier precisa ser coerente e válido.
    let document: string | null = null;
    let documentType: DocumentType | null = null;
    if (props.document != null && props.document !== '') {
      if (!props.documentType) {
        throw new InvalidWorkspaceError('documentType é obrigatório com document');
      }
      const digits = onlyDigits(props.document);
      if (!isValidDocument(props.documentType, digits)) {
        throw new InvalidWorkspaceError(`${props.documentType.toUpperCase()} inválido`);
      }
      document = digits;
      documentType = props.documentType;
    }

    const now = new Date();
    return new Workspace(
      generateId(),
      props.name.trim(),
      props.slug ?? slugify(props.name),
      props.type ?? 'creator',
      props.ownerUserId,
      props.planKey ?? DEFAULT_PLAN_KEY,
      'active',
      now,
      now,
      document,
      documentType,
    );
  }

  static reconstitute(props: WorkspacePersistenceShape): Workspace {
    return new Workspace(
      props._id,
      props.name,
      props.slug,
      props.type,
      props.ownerUserId,
      props.planKey,
      props.subscriptionStatus,
      props.subscriptionStartedAt,
      props.createdAt,
      props.document ?? null,
      props.documentType ?? null,
    );
  }

  getId(): string {
    return this.id;
  }
  getName(): string {
    return this.name;
  }
  getSlug(): string {
    return this.slug;
  }
  getType(): WorkspaceType {
    return this.type;
  }
  getOwnerUserId(): string {
    return this.ownerUserId;
  }
  getPlanKey(): PlanKey {
    return this.planKey;
  }
  getSubscriptionStatus(): SubscriptionStatus {
    return this.subscriptionStatus;
  }
  getCreatedAt(): Date {
    return this.createdAt;
  }
  getDocument(): string | null {
    return this.document;
  }
  getDocumentType(): DocumentType | null {
    return this.documentType;
  }

  rename(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new InvalidWorkspaceError('name não pode ser vazio');
    }
    this.name = name.trim();
    this.slug = slugify(name);
  }

  /** Troca o plano (billing futuro). Mantém o invariante de status válido. */
  setPlan(planKey: PlanKey, status: SubscriptionStatus = 'active'): void {
    this.planKey = planKey;
    this.subscriptionStatus = status;
  }

  toPersistence(): WorkspacePersistenceShape {
    return {
      _id: this.id,
      name: this.name,
      slug: this.slug,
      type: this.type,
      ownerUserId: this.ownerUserId,
      planKey: this.planKey,
      subscriptionStatus: this.subscriptionStatus,
      subscriptionStartedAt: this.subscriptionStartedAt,
      createdAt: this.createdAt,
      document: this.document,
      documentType: this.documentType,
    };
  }
}
