/**
 * TwitchOAuthService — fluxo OAuth Authorization Code para Twitch.
 *
 * Espelha o `KickOAuthService` (KCK-01): state HMAC+TTL, exchange code,
 * tokens cifrados via `CryptoService` (AUTH-02) e persistidos em
 * `ChannelOAuthToken` (mesma collection do Kick).
 *
 * Diferenças vs. Kick:
 *  - O state carrega apenas `userId` (do JWT da console). Não exige
 *    `channelId` pré-existente — o channel é criado a partir do
 *    `helix/users` após o exchange.
 *  - Refresh de access_token usa o mesmo endpoint `oauth2/token` com
 *    grant_type=refresh_token (já implementado em `TwitchTokenRefresher`
 *    para canais "bot-mode"; aqui mantemos local pra desacoplar).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  ChannelOAuthToken,
  type ChannelOAuthTokenRepository,
} from '@sehloro/domain';
import { CryptoService } from '../../crypto/crypto.service';
import type { AppConfig } from '../../config/config.schema';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string[] | string;
}

export interface TwitchHelixUser {
  id: string;
  login: string;
  display_name: string;
  email?: string;
  profile_image_url?: string;
}

@Injectable()
export class TwitchOAuthService {
  private readonly logger = new Logger(TwitchOAuthService.name);
  private readonly inFlight = new Map<string, Promise<ChannelOAuthToken>>();

  constructor(
    @Inject(CHANNEL_OAUTH_TOKEN_REPOSITORY)
    private readonly tokenRepo: ChannelOAuthTokenRepository,
    private readonly cryptoService: CryptoService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ─── state CSRF ──────────────────────────────────────────────────────────

  generateState(userId: string, postLoginRedirect?: string): string {
    const nonce = randomBytes(16).toString('hex');
    const exp = Date.now() + STATE_TTL_MS;
    const payload = Buffer.from(
      JSON.stringify({ userId, nonce, exp, redirect: postLoginRedirect ?? null }),
    ).toString('base64url');
    const sig = this._sign(payload);
    return `${payload}.${sig}`;
  }

  verifyState(state: string): { userId: string; redirect: string | null } {
    const dot = state.lastIndexOf('.');
    if (dot === -1) throw new UnauthorizedException('state inválido');
    const payload = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = this._sign(payload);
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      throw new UnauthorizedException('state adulterado');
    }
    let parsed: { userId: string; nonce: string; exp: number; redirect: string | null };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new UnauthorizedException('state inválido');
    }
    if (Date.now() > parsed.exp) throw new UnauthorizedException('state expirado');
    return { userId: parsed.userId, redirect: parsed.redirect };
  }

  // ─── exchange code → tokens + helix user info ─────────────────────────────

  async exchangeCode(args: {
    code: string;
    redirectUri: string;
  }): Promise<{ token: TwitchTokenResponse; user: TwitchHelixUser }> {
    const clientId = this.config.get('TWITCH_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('TWITCH_CLIENT_SECRET', { infer: true });
    if (!clientId || !clientSecret) {
      throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET não configurados');
    }

    const { data: token } = await axios.post<TwitchTokenResponse>(
      TWITCH_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const { data: userResp } = await axios.get<{ data: TwitchHelixUser[] }>(TWITCH_USERS_URL, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Client-Id': clientId,
      },
    });

    const user = userResp.data[0];
    if (!user) {
      throw new Error('helix/users não retornou usuário — escopo user:read:email?');
    }
    return { token, user };
  }

  /**
   * Persiste o token cifrado vinculado ao `channelId` (canal Sehloro,
   * NÃO o twitch user id). O caller é responsável por criar/obter o
   * channel antes de chamar este método.
   */
  async storeToken(args: {
    channelId: string;
    token: TwitchTokenResponse;
  }): Promise<ChannelOAuthToken> {
    const expiresAt = new Date(Date.now() + args.token.expires_in * 1000);
    const scope = Array.isArray(args.token.scope)
      ? args.token.scope.join(' ')
      : (args.token.scope ?? '');
    const accessToken =
      this.cryptoService.encryptField(args.token.access_token) ?? args.token.access_token;
    const refreshToken =
      this.cryptoService.encryptField(args.token.refresh_token) ?? args.token.refresh_token;

    // Re-OAuth do MESMO canal+plataforma: o índice unique (channelId,platform)
    // do schema impede inserir um doc novo, então precisamos preservar o
    // `_id` existente e fazer update in-place. Se for primeiro OAuth desse
    // canal, cai no path `create` (novo UUID).
    const existing = await this.tokenRepo.findByChannelId(args.channelId, 'twitch');
    if (existing) {
      const updated = ChannelOAuthToken.reconstitute({
        id: existing.getId(),
        channelId: args.channelId,
        platform: 'twitch',
        accessToken,
        refreshToken,
        scope,
        expiresAt,
        updatedAt: new Date(),
        // Re-conexão zera o flag de invalidated.
        invalidatedAt: undefined,
      });
      return this.tokenRepo.save(updated);
    }

    const entity = ChannelOAuthToken.create({
      channelId: args.channelId,
      platform: 'twitch',
      accessToken,
      refreshToken,
      scope,
      expiresAt,
    });
    return this.tokenRepo.save(entity);
  }

  // ─── refresh automático ──────────────────────────────────────────────────

  async getValidToken(channelId: string): Promise<string> {
    const inflight = this.inFlight.get(channelId);
    if (inflight) {
      const t = await inflight;
      return this.cryptoService.decryptField(t.getAccessToken()) ?? t.getAccessToken();
    }
    const doc = await this.tokenRepo.findByChannelId(channelId, 'twitch');
    if (!doc) throw new Error(`Token Twitch não encontrado para canal ${channelId}`);

    const needsRefresh =
      doc.isInvalidated() || doc.getExpiresAt().getTime() - Date.now() < REFRESH_BUFFER_MS;
    if (!needsRefresh) {
      return this.cryptoService.decryptField(doc.getAccessToken()) ?? doc.getAccessToken();
    }
    const promise = this._refresh(channelId, doc).finally(() => this.inFlight.delete(channelId));
    this.inFlight.set(channelId, promise);
    const refreshed = await promise;
    return (
      this.cryptoService.decryptField(refreshed.getAccessToken()) ?? refreshed.getAccessToken()
    );
  }

  private async _refresh(
    channelId: string,
    current: ChannelOAuthToken,
  ): Promise<ChannelOAuthToken> {
    const clientId = this.config.get('TWITCH_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('TWITCH_CLIENT_SECRET', { infer: true });
    const plainRefresh =
      this.cryptoService.decryptField(current.getRefreshToken()) ?? current.getRefreshToken();

    const { data } = await axios.post<TwitchTokenResponse>(
      TWITCH_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId ?? '',
        client_secret: clientSecret ?? '',
        refresh_token: plainRefresh,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    const scope = Array.isArray(data.scope) ? data.scope.join(' ') : (data.scope ?? '');
    const updated = ChannelOAuthToken.reconstitute({
      id: current.getId(),
      channelId,
      platform: 'twitch',
      accessToken: this.cryptoService.encryptField(data.access_token) ?? data.access_token,
      refreshToken: this.cryptoService.encryptField(data.refresh_token) ?? data.refresh_token,
      scope,
      expiresAt,
      updatedAt: new Date(),
    });
    this.logger.log(`Token Twitch renovado canal=${channelId}`);
    return this.tokenRepo.save(updated);
  }

  private _sign(payload: string): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
}
