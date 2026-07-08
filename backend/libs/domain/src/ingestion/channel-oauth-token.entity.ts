/**
 * Entidade de domínio: ChannelOAuthToken (Ingestion bounded context).
 *
 * Representa o par de tokens OAuth (access + refresh) de um canal numa
 * dada plataforma (Twitch ou Kick). Os bots legados guardam esses tokens
 * em `.env` e rodam `atualizarToken()` para refresh — esta entidade é o
 * equivalente persistido que os workers NestJS futuros vão ler/gravar no
 * Mongo por canal.
 *
 * REGRA CRÍTICA: esta entidade é PURE TS. Não importa `node:crypto` nem
 * sabe que os tokens são encriptados em disco. A criptografia mora na
 * camada de infra (`libs/infra/src/crypto`). Aqui, `accessToken` e
 * `refreshToken` sempre representam plaintext em memória — o mapper de
 * infra + plugin Mongoose cuidam da conversão transparentemente.
 */
import { DomainError } from '../errors/domain-error';
import { ChannelPlatform } from './channel.entity';
import { generateId } from '../shared/identity';

export interface ChannelOAuthTokenPersistenceShape {
  _id: string;
  channelId: string;
  platform: ChannelPlatform;
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
  updatedAt: Date;
  invalidatedAt?: Date;
}

export class InvalidChannelOAuthTokenError extends DomainError {
  public readonly code = 'INVALID_CHANNEL_OAUTH_TOKEN';
  public readonly statusCode = 422;
}

export class ChannelOAuthToken {
  private constructor(
    private readonly id: string,
    private readonly channelId: string,
    private readonly platform: ChannelPlatform,
    private readonly accessToken: string,
    private readonly refreshToken: string,
    private readonly scope: string,
    private readonly expiresAt: Date,
    private readonly updatedAt: Date,
    private readonly invalidatedAt?: Date,
  ) {}

  static create(props: {
    channelId: string;
    platform: ChannelPlatform;
    accessToken: string;
    refreshToken: string;
    scope?: string;
    expiresAt: Date;
  }): ChannelOAuthToken {
    ChannelOAuthToken.assertInvariants(props);
    return new ChannelOAuthToken(
      generateId(),
      props.channelId,
      props.platform,
      props.accessToken,
      props.refreshToken,
      props.scope ?? '',
      props.expiresAt,
      new Date(),
    );
  }

  static reconstitute(props: {
    id: string;
    channelId: string;
    platform: ChannelPlatform;
    accessToken: string;
    refreshToken: string;
    scope: string;
    expiresAt: Date;
    updatedAt: Date;
    invalidatedAt?: Date;
  }): ChannelOAuthToken {
    return new ChannelOAuthToken(
      props.id,
      props.channelId,
      props.platform,
      props.accessToken,
      props.refreshToken,
      props.scope,
      props.expiresAt,
      props.updatedAt,
      props.invalidatedAt,
    );
  }

  private static assertInvariants(props: {
    channelId: string;
    platform: ChannelPlatform;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }): void {
    if (!props.channelId || props.channelId.trim().length === 0) {
      throw new InvalidChannelOAuthTokenError('channelId não pode ser vazio');
    }
    if (props.platform !== 'twitch' && props.platform !== 'kick') {
      throw new InvalidChannelOAuthTokenError(`platform inválida: ${String(props.platform)}`);
    }
    if (!props.accessToken || props.accessToken.length === 0) {
      throw new InvalidChannelOAuthTokenError('accessToken não pode ser vazio');
    }
    if (!props.refreshToken || props.refreshToken.length === 0) {
      throw new InvalidChannelOAuthTokenError('refreshToken não pode ser vazio');
    }
    if (!(props.expiresAt instanceof Date) || isNaN(props.expiresAt.getTime())) {
      throw new InvalidChannelOAuthTokenError('expiresAt deve ser uma Date válida');
    }
  }

  getId(): string {
    return this.id;
  }

  getChannelId(): string {
    return this.channelId;
  }

  getPlatform(): ChannelPlatform {
    return this.platform;
  }

  getAccessToken(): string {
    return this.accessToken;
  }

  getRefreshToken(): string {
    return this.refreshToken;
  }

  getScope(): string {
    return this.scope;
  }

  getExpiresAt(): Date {
    return this.expiresAt;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }

  getInvalidatedAt(): Date | undefined {
    return this.invalidatedAt;
  }

  isInvalidated(): boolean {
    return this.invalidatedAt != null;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Projeção para persistência. Os nomes são camelCase alinhados ao schema
   * Mongoose novo (`channel_oauth_tokens`). O plugin de encryption-at-rest
   * intercepta os campos sensíveis transparentemente — esta projeção
   * continua devolvendo plaintext.
   */
  toPersistence(): ChannelOAuthTokenPersistenceShape {
    return {
      _id: this.id,
      channelId: this.channelId,
      platform: this.platform,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      scope: this.scope,
      expiresAt: this.expiresAt,
      updatedAt: this.updatedAt,
      ...(this.invalidatedAt ? { invalidatedAt: this.invalidatedAt } : {}),
    };
  }
}
