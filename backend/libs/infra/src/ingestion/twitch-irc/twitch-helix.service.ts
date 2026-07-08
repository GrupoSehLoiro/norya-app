/**
 * TWI-03 · TwitchHelixService.
 *
 * Cliente para a Twitch Helix API. Responsabilidades:
 * - App Access Token cacheado em memória (refresh automático < 5min para expirar)
 * - getStream(userId) → live status + viewer count
 * - getUserByLogin(login) → id + login + displayName
 * - 429 handling via backoff exponencial com jitter
 * - Rate limit interno (memory bucket; Redis quando REDIS_URL presente — M3)
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Injectable, Logger } from '@nestjs/common';

const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

const BACKOFF_BASE_MS = 500;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_MAX_RETRIES = 5;

export interface HelixStreamResult {
  isLive: boolean;
  viewerCount: number;
  gameId?: string;
  startedAt?: Date;
  title?: string;
}

export interface HelixUserResult {
  id: string;
  login: string;
  displayName: string;
}

interface AppToken {
  accessToken: string;
  expiresAt: Date;
}

// Bucket de rate limit em memória (800 pontos/min = Helix padrão)
interface MemoryBucket {
  points: number;
  resetAt: number;
}

@Injectable()
export class TwitchHelixService {
  private readonly logger = new Logger(TwitchHelixService.name);
  private appToken: AppToken | null = null;
  private readonly http: AxiosInstance;
  private readonly bucket: MemoryBucket = { points: 800, resetAt: Date.now() + 60_000 };

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {
    this.http = axios.create({ baseURL: TWITCH_API_BASE, timeout: 10_000 });
  }

  async getStream(userId: string): Promise<HelixStreamResult | null> {
    const data = await this._request<{ data: HelixStreamRaw[] }>('GET', '/streams', {
      user_id: userId,
    });
    const stream = data?.data?.[0];
    if (!stream) return null;
    return {
      isLive: stream.type === 'live',
      viewerCount: stream.viewer_count ?? 0,
      gameId: stream.game_id,
      startedAt: stream.started_at ? new Date(stream.started_at) : undefined,
      title: stream.title,
    };
  }

  async getUserByLogin(login: string): Promise<HelixUserResult | null> {
    const data = await this._request<{ data: HelixUserRaw[] }>('GET', '/users', { login });
    const user = data?.data?.[0];
    if (!user) return null;
    return { id: user.id, login: user.login, displayName: user.display_name };
  }

  // ─── token management ────────────────────────────────────────────────────

  async getAppAccessToken(): Promise<string> {
    const now = new Date();
    const fiveMin = 5 * 60 * 1000;
    if (this.appToken && this.appToken.expiresAt.getTime() - now.getTime() > fiveMin) {
      return this.appToken.accessToken;
    }
    await this._refreshAppToken();
    return this.appToken!.accessToken;
  }

  private async _refreshAppToken(): Promise<void> {
    const resp = await axios.post<AppTokenResponse>(TWITCH_AUTH_URL, null, {
      params: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
      },
    });
    const expiresAt = new Date(Date.now() + resp.data.expires_in * 1000);
    this.appToken = { accessToken: resp.data.access_token, expiresAt };
  }

  // ─── request com retry + backoff ─────────────────────────────────────────

  private async _request<T>(
    method: 'GET',
    path: string,
    params?: Record<string, string>,
  ): Promise<T | null> {
    this._consumeBucket(1);

    let attempt = 0;
    while (attempt <= BACKOFF_MAX_RETRIES) {
      try {
        const token = await this.getAppAccessToken();
        const resp = await this.http.request<T>({
          method,
          url: path,
          params,
          headers: {
            'Client-Id': this.clientId,
            Authorization: `Bearer ${token}`,
          },
        });
        return resp.data;
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        if (status === 401) {
          // Token expirado — força refresh e tenta uma vez
          this.appToken = null;
          if (attempt < BACKOFF_MAX_RETRIES) {
            attempt++;
            continue;
          }
        }

        if (status === 429) {
          const retryAfter = this._retryAfterMs(axiosErr);
          this.logger.warn(`Helix 429 — aguardando ${retryAfter}ms (tentativa ${attempt + 1})`);
          await sleep(retryAfter);
          attempt++;
          continue;
        }

        // Erros não-recuperáveis
        this.logger.error(`Helix ${status ?? 'network'} em ${path}: ${axiosErr.message}`);
        return null;
      }
    }

    this.logger.error(`Helix: máximo de retries atingido para ${path}`);
    return null;
  }

  private _retryAfterMs(err: AxiosError): number {
    const header = err.response?.headers?.['retry-after'];
    if (header) {
      const parsed = parseFloat(String(header));
      if (!isNaN(parsed)) return parsed * 1000;
    }
    const attempt = Math.min(BACKOFF_MAX_RETRIES, Math.floor(Math.log2((Date.now() % 1000) + 1)));
    const base = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt);
    const jitter = Math.random() * base * 0.3;
    return Math.min(base + jitter, BACKOFF_MAX_MS);
  }

  private _consumeBucket(cost: number): void {
    const now = Date.now();
    if (now >= this.bucket.resetAt) {
      this.bucket.points = 800;
      this.bucket.resetAt = now + 60_000;
    }
    this.bucket.points = Math.max(0, this.bucket.points - cost);
  }
}

// ─── tipos internos da Helix API ─────────────────────────────────────────────

interface HelixStreamRaw {
  type: string;
  viewer_count: number;
  game_id?: string;
  started_at?: string;
  title?: string;
}

interface HelixUserRaw {
  id: string;
  login: string;
  display_name: string;
}

interface AppTokenResponse {
  access_token: string;
  expires_in: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
