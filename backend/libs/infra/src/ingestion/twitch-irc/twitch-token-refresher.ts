/**
 * TWI-04 · TwitchTokenRefresher.
 *
 * Porta o padrão `tokenUpdating` dos bots legados (Riotgames/index.js linhas 69-127)
 * para o contexto NestJS com persistência via ChannelOAuthTokenRepository.
 *
 * Destaques:
 * - Mutex por channelId via Map<channelId, Promise> — N chamadas concorrentes
 *   para o mesmo canal resolvem em 1 único request HTTP (sem thundering herd).
 * - CryptoService encripta o novo accessToken antes de persistir.
 * - EventEmitter emite TwitchTokenRefreshedEvent ou TwitchTokenInvalidEvent
 *   para que o OrchestratorService (M2/ORC-03) possa reagir.
 * - Refresh inválido (400/401) marca o token como invalidado e nunca retenta
 *   automaticamente — o streamer precisa refazer o fluxo OAuth.
 */
import axios, { AxiosError } from 'axios';
import { EventEmitter } from 'node:events';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  ChannelOAuthToken,
  ChannelOAuthTokenRepository,
  ChannelPlatform,
} from '@sehloro/domain';
import { CryptoService } from '../../crypto/crypto.service';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 min

// ─── eventos ─────────────────────────────────────────────────────────────────

export const TWITCH_TOKEN_EVENTS = 'twitch-token-events';

export interface TwitchTokenRefreshedEvent {
  type: 'refreshed';
  channelId: string;
  platform: ChannelPlatform;
}

export interface TwitchTokenInvalidEvent {
  type: 'invalid';
  channelId: string;
  platform: ChannelPlatform;
  reason: string;
}

export type TwitchTokenEvent = TwitchTokenRefreshedEvent | TwitchTokenInvalidEvent;

// ─── service ─────────────────────────────────────────────────────────────────

@Injectable()
export class TwitchTokenRefresher {
  private readonly logger = new Logger(TwitchTokenRefresher.name);
  /** Mutex: channelId → Promise em andamento, se houver. */
  private readonly inFlight = new Map<string, Promise<ChannelOAuthToken>>();

  readonly events = new EventEmitter();

  constructor(
    @Inject(CHANNEL_OAUTH_TOKEN_REPOSITORY)
    private readonly tokenRepo: ChannelOAuthTokenRepository,
    private readonly cryptoService: CryptoService,
    @Optional()
    private readonly clientId?: string,
    @Optional()
    private readonly clientSecret?: string,
  ) {}

  /**
   * Retorna o token atualizado. Se ainda válido (> 5min para expirar), devolve
   * sem fazer request. Garante no máximo 1 request por canal em paralelo.
   */
  async refreshIfNeeded(tokenDoc: ChannelOAuthToken): Promise<ChannelOAuthToken> {
    const now = new Date();
    const timeToExpiry = tokenDoc.getExpiresAt().getTime() - now.getTime();

    if (timeToExpiry > REFRESH_BUFFER_MS && !tokenDoc.isInvalidated()) {
      return tokenDoc;
    }

    const channelId = tokenDoc.getChannelId();

    const existing = this.inFlight.get(channelId);
    if (existing) return existing;

    const promise = this._doRefresh(tokenDoc).finally(() => {
      this.inFlight.delete(channelId);
    });

    this.inFlight.set(channelId, promise);
    return promise;
  }

  private async _doRefresh(tokenDoc: ChannelOAuthToken): Promise<ChannelOAuthToken> {
    const channelId = tokenDoc.getChannelId();
    const platform = tokenDoc.getPlatform();
    const refreshToken = this.cryptoService.decryptField(tokenDoc.getRefreshToken());

    if (!refreshToken) {
      return this._handleInvalid(tokenDoc, 'refreshToken ausente ou indecifrável');
    }

    try {
      const resp = await axios.post<TwitchTokenResponse>(TWITCH_TOKEN_URL, null, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
      });

      const { access_token, refresh_token, expires_in, scope } = resp.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Cria novo token com valores atualizados
      const newToken = ChannelOAuthToken.create({
        channelId,
        platform,
        accessToken: this.cryptoService.encrypt(access_token),
        refreshToken: this.cryptoService.encrypt(refresh_token ?? refreshToken),
        scope: Array.isArray(scope) ? scope.join(' ') : (scope ?? ''),
        expiresAt,
      });

      const saved = await this.tokenRepo.save(newToken);

      this.events.emit(TWITCH_TOKEN_EVENTS, {
        type: 'refreshed',
        channelId,
        platform,
      } satisfies TwitchTokenRefreshedEvent);

      this.logger.log(`Token renovado para canal ${channelId}`);
      return saved;
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status === 400 || status === 401) {
        return this._handleInvalid(tokenDoc, `HTTP ${status} — refresh token inválido`);
      }
      this.logger.error(`Erro inesperado ao renovar token para ${channelId}: ${String(err)}`);
      throw err;
    }
  }

  private async _handleInvalid(tokenDoc: ChannelOAuthToken, reason: string): Promise<never> {
    const channelId = tokenDoc.getChannelId();
    const platform = tokenDoc.getPlatform();

    const invalidated = ChannelOAuthToken.reconstitute({
      id: tokenDoc.getId(),
      channelId,
      platform,
      accessToken: tokenDoc.getAccessToken(),
      refreshToken: tokenDoc.getRefreshToken(),
      scope: tokenDoc.getScope(),
      expiresAt: tokenDoc.getExpiresAt(),
      updatedAt: tokenDoc.getUpdatedAt(),
      invalidatedAt: new Date(),
    });

    await this.tokenRepo.save(invalidated);

    this.events.emit(TWITCH_TOKEN_EVENTS, {
      type: 'invalid',
      channelId,
      platform,
      reason,
    } satisfies TwitchTokenInvalidEvent);

    this.logger.warn(`Token invalidado para canal ${channelId}: ${reason}`);
    throw new Error(`TwitchTokenInvalidError: ${reason}`);
  }
}

interface TwitchTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string | string[];
}
