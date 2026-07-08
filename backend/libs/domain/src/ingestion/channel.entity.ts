/**
 * Entidade de domínio: Channel (Ingestion bounded context).
 *
 * Pure TS — sem imports de framework. Ver regras em user.entity.ts.
 *
 * Mapeamento domínio → persistência legada:
 *   - `name` (domínio)            → `channel` (Mongo)
 *   - `getChannelWithPrefix()`    → `channelWithPrefix` (Mongo)
 *   - `createdAt`                 → `created_at` (Mongo)
 *   - `active`, `platform`, `externalId` permanecem (os dois últimos são
 *     novos — o schema legado não os tinha; serão colunas opcionais).
 *
 * `platform` e `externalId` são campos do alvo arquitetural (multi-plataforma
 * Twitch + Kick). No M1 os bots legados continuam escrevendo só `channel`,
 * `channelWithPrefix`, `created_at`, `active`; entidades rehidratadas vão
 * ter `platform = 'twitch'` como default implícito no reconstitute (a partir
 * do formato do prefix, quando disponível). Para NEST-04 deixamos isso
 * explícito no mapper de infra.
 */
import { DomainError } from '../errors/domain-error';
import { generateId } from '../shared/identity';

export type ChannelPlatform = 'twitch' | 'kick';

export interface ChannelPersistenceShape {
  _id: string;
  channel: string;
  channelWithPrefix: string;
  created_at: Date;
  active: boolean;
  platform: ChannelPlatform;
  externalId?: string;
  displayName?: string;
  ownerId?: string;
  flags?: Record<string, boolean>;
  /** Creator dono da integração (multi-plataforma). Opcional na transição. */
  creatorId?: string;
  /** Workspace (tenant) da integração. Opcional na transição. */
  workspaceId?: string;
}

export class InvalidChannelError extends DomainError {
  public readonly code = 'INVALID_CHANNEL';
  public readonly statusCode = 422;
}

export class Channel {
  private constructor(
    private readonly id: string,
    private readonly name: string,
    private readonly platform: ChannelPlatform,
    private readonly active: boolean,
    private readonly createdAt: Date,
    private readonly externalId?: string,
    private readonly displayName?: string,
    private readonly ownerId?: string,
    private readonly flags?: Record<string, boolean>,
    private creatorId?: string,
    private workspaceId?: string,
  ) {}

  static create(props: {
    name: string;
    platform: ChannelPlatform;
    externalId?: string;
    displayName?: string;
    ownerId?: string;
    flags?: Record<string, boolean>;
    active?: boolean;
    createdAt?: Date;
    creatorId?: string;
    workspaceId?: string;
  }): Channel {
    Channel.assertInvariants(props);
    return new Channel(
      generateId(),
      props.name,
      props.platform,
      props.active ?? true,
      props.createdAt ?? new Date(),
      props.externalId,
      props.displayName,
      props.ownerId,
      props.flags,
      props.creatorId,
      props.workspaceId,
    );
  }

  static reconstitute(props: {
    id: string;
    name: string;
    platform: ChannelPlatform;
    active: boolean;
    createdAt: Date;
    externalId?: string;
    displayName?: string;
    ownerId?: string;
    flags?: Record<string, boolean>;
    creatorId?: string;
    workspaceId?: string;
  }): Channel {
    return new Channel(
      props.id,
      props.name,
      props.platform,
      props.active,
      props.createdAt,
      props.externalId,
      props.displayName,
      props.ownerId,
      props.flags,
      props.creatorId,
      props.workspaceId,
    );
  }

  private static assertInvariants(props: { name: string; platform: ChannelPlatform }): void {
    if (!props.name || props.name.trim().length === 0) {
      throw new InvalidChannelError('name não pode ser vazio');
    }
    if (props.platform !== 'twitch' && props.platform !== 'kick') {
      throw new InvalidChannelError(`platform inválida: ${String(props.platform)}`);
    }
  }

  /**
   * Derivação do nome "público" do canal com prefixo da plataforma.
   * Twitch usa `#canal` (legado). Kick não tem prefixo no protocolo, mas
   * mantemos a convenção `#canal` para uniformidade no frontend — pode ser
   * ajustado quando a ingestão Kick for real.
   */
  getChannelWithPrefix(): string {
    switch (this.platform) {
      case 'twitch':
        return `#${this.name}`;
      case 'kick':
        return `#${this.name}`;
    }
  }

  getId(): string {
    return this.id;
  }

  getName(): string {
    return this.name;
  }

  getPlatform(): ChannelPlatform {
    return this.platform;
  }

  getExternalId(): string | undefined {
    return this.externalId;
  }

  getDisplayName(): string | undefined {
    return this.displayName;
  }

  getOwnerId(): string | undefined {
    return this.ownerId;
  }

  getCreatorId(): string | undefined {
    return this.creatorId;
  }

  getWorkspaceId(): string | undefined {
    return this.workspaceId;
  }

  /** Vincula a integração a um Creator/Workspace (linking do onboarding). */
  linkToCreator(creatorId: string, workspaceId: string): void {
    this.creatorId = creatorId;
    this.workspaceId = workspaceId;
  }

  getFlags(): Record<string, boolean> {
    return this.flags ?? {};
  }

  getFlag(key: string): boolean {
    return this.flags?.[key] ?? false;
  }

  isActive(): boolean {
    return this.active;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  toPersistence(): ChannelPersistenceShape {
    return {
      _id: this.id,
      channel: this.name,
      channelWithPrefix: this.getChannelWithPrefix(),
      created_at: this.createdAt,
      active: this.active,
      platform: this.platform,
      externalId: this.externalId,
      displayName: this.displayName,
      ownerId: this.ownerId,
      flags: this.flags,
      creatorId: this.creatorId,
      workspaceId: this.workspaceId,
    };
  }
}
