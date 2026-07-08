/**
 * Entidade de domínio: Creator (Creator bounded context).
 *
 * O Creator é o "canal" no sentido de produto — o streamer. Agrupa as
 * **integrações** (Twitch/Kick/…, que vivem na collection `channels`) e carrega
 * o **perfil** (`CreatorProfile`: nicho, categoria, etc.). Pertence a um
 * Workspace. Um workspace `creator` normalmente tem 1 Creator; `agency` tem N.
 */
import { DomainError } from '../errors/domain-error';
import { generateId } from '../shared/identity';
import { slugify } from '../shared/slug';

export type CreatorStatus = 'active' | 'archived';

export interface CreatorPersistenceShape {
  _id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: CreatorStatus;
  createdAt: Date;
}

export class InvalidCreatorError extends DomainError {
  public readonly code = 'INVALID_CREATOR';
  public readonly statusCode = 422;
}

export class Creator {
  private constructor(
    private readonly id: string,
    private readonly workspaceId: string,
    private name: string,
    private slug: string,
    private status: CreatorStatus,
    private readonly createdAt: Date,
  ) {}

  static create(props: { workspaceId: string; name: string; slug?: string }): Creator {
    if (!props.workspaceId) {
      throw new InvalidCreatorError('workspaceId é obrigatório');
    }
    if (!props.name || props.name.trim().length === 0) {
      throw new InvalidCreatorError('name não pode ser vazio');
    }
    return new Creator(
      generateId(),
      props.workspaceId,
      props.name.trim(),
      props.slug ?? slugify(props.name),
      'active',
      new Date(),
    );
  }

  static reconstitute(props: CreatorPersistenceShape): Creator {
    return new Creator(
      props._id,
      props.workspaceId,
      props.name,
      props.slug,
      props.status,
      props.createdAt,
    );
  }

  getId(): string {
    return this.id;
  }
  getWorkspaceId(): string {
    return this.workspaceId;
  }
  getName(): string {
    return this.name;
  }
  getSlug(): string {
    return this.slug;
  }
  getStatus(): CreatorStatus {
    return this.status;
  }
  getCreatedAt(): Date {
    return this.createdAt;
  }

  rename(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new InvalidCreatorError('name não pode ser vazio');
    }
    this.name = name.trim();
    this.slug = slugify(name);
  }
  archive(): void {
    this.status = 'archived';
  }

  toPersistence(): CreatorPersistenceShape {
    return {
      _id: this.id,
      workspaceId: this.workspaceId,
      name: this.name,
      slug: this.slug,
      status: this.status,
      createdAt: this.createdAt,
    };
  }
}
