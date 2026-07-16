/**
 * KCK-01 · KickOAuthService.
 *
 * Gerencia o fluxo OAuth 2.0 (Authorization Code) para Kick:
 *  - generateState / verifyState: proteção CSRF via HMAC+TTL
 *  - exchangeCode: troca code por access_token + refresh_token no Kick IdP
 *  - getValidToken: devolve access token plaintext, renovando se < 5 min de validade
 *
 * Tokens são persistidos criptografados via CryptoService (AUTH-02).
 * Análogo ao TwitchTokenRefresher (TWI-04), com mutex por channelId.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  ChannelOAuthToken,
  ChannelOAuthTokenRepository,
} from '@sehloro/domain';
import { CryptoService } from '../../crypto/crypto.service';
import type { AppConfig } from '../../config/config.schema';

const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const KICK_PUBLIC_API = 'https://api.kick.com/public/v1';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 min

export interface KickTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/** Identidade do streamer que autorizou — usada pra auto-criar o Channel. */
export interface KickAuthenticatedChannel {
  broadcasterUserId: string;
  slug: string;
  displayName: string;
}

// Shape parcial de GET /public/v1/channels (token-owner).
interface KickPublicChannelsResponse {
  data?: Array<{
    broadcaster_user_id?: number;
    slug?: string;
    channel_description?: string;
    stream_title?: string;
  }>;
  message?: string;
}

@Injectable()
export class KickOAuthService {
  private readonly logger = new Logger(KickOAuthService.name);
  private readonly inFlight = new Map<string, Promise<ChannelOAuthToken>>();

  constructor(
    @Inject(CHANNEL_OAUTH_TOKEN_REPOSITORY)
    private readonly tokenRepo: ChannelOAuthTokenRepository,
    private readonly cryptoService: CryptoService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ─── state CSRF ───────────────────────────────────────────────────────────

  // PKCE (OAuth 2.1) — o Kick EXIGE code_challenge no /authorize; sem ele o
  // IdP faz 307 pra raiz (404). Gera o par verifier/challenge (S256).
  createPkcePair(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = randomBytes(32).toString('base64url'); // ~43 chars
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  // Fluxo de paridade com o Twitch: o state carrega o `userId` (dono do
  // console) — o canal só é conhecido DEPOIS do OAuth, resolvido pela
  // identidade Kick que autorizou (ver fetchAuthenticatedChannel). Carrega
  // também o `codeVerifier` (PKCE) pra reconstruí-lo no callback sem estado
  // server-side. State é HMAC-assinado; cliente confidencial (usa client_secret).
  generateState(
    userId: string,
    redirect?: string,
    codeVerifier?: string,
    workspaceId?: string,
  ): string {
    const nonce = randomBytes(16).toString('hex');
    const exp = Date.now() + STATE_TTL_MS;
    // `workspaceId` viaja no state pro callback (@Public, sem JWT) conseguir
    // auto-vincular o canal ao creator do workspace ativo.
    const payload = Buffer.from(
      JSON.stringify({
        userId,
        redirect,
        codeVerifier,
        workspaceId: workspaceId ?? null,
        nonce,
        exp,
      }),
    ).toString('base64url');
    const sig = this._sign(payload);
    return `${payload}.${sig}`;
  }

  verifyState(state: string): {
    userId: string;
    redirect?: string;
    codeVerifier?: string;
    workspaceId: string | null;
  } {
    const dot = state.lastIndexOf('.');
    if (dot === -1) throw new UnauthorizedException('state inválido');

    const payload = state.slice(0, dot);
    const sig = state.slice(dot + 1);

    const expected = this._sign(payload);
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new UnauthorizedException('state adulterado');
    }

    let parsed: {
      userId: string;
      redirect?: string;
      codeVerifier?: string;
      workspaceId?: string | null;
      exp: number;
    };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new UnauthorizedException('state inválido');
    }

    if (Date.now() > parsed.exp) {
      throw new UnauthorizedException('state expirado');
    }

    return {
      userId: parsed.userId,
      redirect: parsed.redirect,
      codeVerifier: parsed.codeVerifier,
      workspaceId: parsed.workspaceId ?? null,
    };
  }

  // ─── token exchange ───────────────────────────────────────────────────────

  /**
   * Troca o authorization code por tokens no Kick IdP. NÃO persiste — no fluxo
   * de paridade o channelId só é conhecido depois (via fetchAuthenticatedChannel).
   */
  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<KickTokenResponse> {
    const clientId = this.config.get('KICK_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('KICK_CLIENT_SECRET', { infer: true });

    if (!clientId || !clientSecret) {
      throw new Error('KICK_CLIENT_ID / KICK_CLIENT_SECRET não configurados');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    // PKCE: o Kick exige o code_verifier que casa com o code_challenge do /start.
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const { data } = await axios.post<KickTokenResponse>(KICK_TOKEN_URL, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return data;
  }

  /** Persiste o token (cifrado) vinculado a um channelId já resolvido. */
  async storeToken(channelId: string, data: KickTokenResponse): Promise<ChannelOAuthToken> {
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    const tokenEntity = ChannelOAuthToken.create({
      channelId,
      platform: 'kick',
      accessToken: this.cryptoService.encryptField(data.access_token) ?? data.access_token,
      refreshToken: this.cryptoService.encryptField(data.refresh_token) ?? data.refresh_token,
      scope: data.scope,
      expiresAt,
    });

    return this.tokenRepo.save(tokenEntity);
  }

  /**
   * Descobre o canal do streamer que acabou de autorizar — análogo ao lookup
   * Helix no fluxo Twitch. Usa a Kick public API com o próprio access_token:
   *   GET https://api.kick.com/public/v1/channels  → canal do token-owner.
   * Requer o scope `channel:read` (já pedido no /start).
   */
  async fetchAuthenticatedChannel(accessToken: string): Promise<KickAuthenticatedChannel> {
    const { data } = await axios.get<KickPublicChannelsResponse>(`${KICK_PUBLIC_API}/channels`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    const ch = data?.data?.[0];
    if (!ch || !ch.slug) {
      throw new Error('Kick public API não retornou canal para o token autorizado');
    }

    return {
      broadcasterUserId: ch.broadcaster_user_id != null ? String(ch.broadcaster_user_id) : '',
      slug: ch.slug,
      displayName: ch.slug,
    };
  }

  /**
   * Backward-compat (channelId já conhecido): troca + persiste num passo.
   * Mantido para chamadas/legados que não passam pelo fluxo de auto-criação.
   */
  async exchangeCode(
    code: string,
    channelId: string,
    redirectUri: string,
  ): Promise<ChannelOAuthToken> {
    const data = await this.exchangeCodeForTokens(code, redirectUri);
    return this.storeToken(channelId, data);
  }

  // ─── getValidToken — com auto-refresh ────────────────────────────────────

  async getValidToken(channelId: string): Promise<string> {
    const inflight = this.inFlight.get(channelId);
    if (inflight) {
      const token = await inflight;
      return this.cryptoService.decryptField(token.getAccessToken()) ?? token.getAccessToken();
    }

    const tokenDoc = await this.tokenRepo.findByChannelId(channelId, 'kick');
    if (!tokenDoc) {
      throw new Error(`Token Kick não encontrado para canal ${channelId}`);
    }

    const needsRefresh =
      tokenDoc.isInvalidated() ||
      tokenDoc.getExpiresAt().getTime() - Date.now() < REFRESH_BUFFER_MS;

    if (!needsRefresh) {
      return (
        this.cryptoService.decryptField(tokenDoc.getAccessToken()) ?? tokenDoc.getAccessToken()
      );
    }

    const promise = this._refreshToken(channelId, tokenDoc).finally(() =>
      this.inFlight.delete(channelId),
    );
    this.inFlight.set(channelId, promise);

    const refreshed = await promise;
    return (
      this.cryptoService.decryptField(refreshed.getAccessToken()) ?? refreshed.getAccessToken()
    );
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  private async _refreshToken(
    channelId: string,
    current: ChannelOAuthToken,
  ): Promise<ChannelOAuthToken> {
    const clientId = this.config.get('KICK_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('KICK_CLIENT_SECRET', { infer: true });

    const plainRefresh =
      this.cryptoService.decryptField(current.getRefreshToken()) ?? current.getRefreshToken();

    try {
      const { data } = await axios.post<KickTokenResponse>(
        KICK_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId ?? '',
          client_secret: clientSecret ?? '',
          refresh_token: plainRefresh,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const expiresAt = new Date(Date.now() + data.expires_in * 1000);
      const updated = ChannelOAuthToken.reconstitute({
        id: current.getId(),
        channelId,
        platform: 'kick',
        accessToken: this.cryptoService.encryptField(data.access_token) ?? data.access_token,
        refreshToken: this.cryptoService.encryptField(data.refresh_token) ?? data.refresh_token,
        scope: data.scope,
        expiresAt,
        updatedAt: new Date(),
      });

      this.logger.log(`Token Kick renovado para canal ${channelId}`);
      return this.tokenRepo.save(updated);
    } catch (err) {
      this.logger.error(`Falha ao renovar token Kick para canal ${channelId}`, err);
      throw err;
    }
  }

  private _sign(payload: string): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
}
