/**
 * KCK-04 · KickRestClient.
 *
 * Acessa endpoints públicos da Kick REST API para descobrir chatroomId e
 * viewer count. Não requer autenticação (endpoints públicos).
 *
 * Cache em memória por slug:
 *  - getChannel: TTL 30 s (chatroomId raramente muda)
 *  - getStream:  TTL 15 s
 *
 * Retorna null em 404. Lança KickApiTimeoutError em timeout de 5 s.
 * Backoff exponencial (3 retries) em 429/5xx via axios-retry inline.
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Injectable, Logger } from '@nestjs/common';

const KICK_API_BASE = 'https://kick.com/api/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

const CACHE_TTL_CHANNEL_MS = 30_000;
const CACHE_TTL_STREAM_MS = 15_000;

export class KickApiTimeoutError extends Error {
  constructor(slug: string) {
    super(`Kick API timeout para slug "${slug}"`);
    this.name = 'KickApiTimeoutError';
  }
}

export interface KickChannelResult {
  id: number;
  slug: string;
  chatroomId: number;
  isLive: boolean;
  viewerCount: number | null;
  title?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class KickRestClient {
  private readonly logger = new Logger(KickRestClient.name);
  private readonly http: AxiosInstance;
  private readonly channelCache = new Map<string, CacheEntry<KickChannelResult | null>>();
  private readonly streamCache = new Map<
    string,
    CacheEntry<{ isLive: boolean; viewerCount: number | null }>
  >();

  constructor() {
    this.http = axios.create({
      baseURL: KICK_API_BASE,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  async getChannel(slug: string): Promise<KickChannelResult | null> {
    const cached = this.channelCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const result = await this._fetchWithRetry<KickChannelResult | null>(
      () => this._fetchChannel(slug),
      slug,
    );
    this.channelCache.set(slug, { value: result, expiresAt: Date.now() + CACHE_TTL_CHANNEL_MS });
    return result;
  }

  async getStream(slug: string): Promise<{ isLive: boolean; viewerCount: number | null }> {
    const cached = this.streamCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const channel = await this.getChannel(slug);
    const result = channel
      ? { isLive: channel.isLive, viewerCount: channel.viewerCount }
      : { isLive: false, viewerCount: null };

    this.streamCache.set(slug, { value: result, expiresAt: Date.now() + CACHE_TTL_STREAM_MS });
    return result;
  }

  private async _fetchChannel(slug: string): Promise<KickChannelResult | null> {
    const { data } = await this.http.get<KickApiChannelResponse>(`/channels/${slug}`);
    return {
      id: data.id,
      slug: data.slug,
      chatroomId: data.chatroom.id,
      isLive: data.livestream?.is_live ?? false,
      viewerCount: data.livestream?.viewer_count ?? null,
      title: data.livestream?.session_title,
    };
  }

  private async _fetchWithRetry<T>(fn: () => Promise<T>, slug: string, attempt = 0): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError;

        if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ERR_CANCELED') {
          throw new KickApiTimeoutError(slug);
        }

        if (axiosErr.response?.status === 404) {
          return null as T;
        }

        const isRetryable =
          (axiosErr.response?.status === 429 || (axiosErr.response?.status ?? 0) >= 500) &&
          attempt < MAX_RETRIES;

        if (isRetryable) {
          const retryAfterHeader = axiosErr.response?.headers?.['retry-after'];
          const delay = retryAfterHeader
            ? Number(retryAfterHeader) * 1000
            : BACKOFF_BASE_MS * Math.pow(2, attempt);

          this.logger.warn(
            `Kick API ${axiosErr.response?.status} — retry ${attempt + 1}/${MAX_RETRIES} em ${delay}ms (slug=${slug})`,
          );
          await new Promise((r) => setTimeout(r, delay));
          return this._fetchWithRetry(fn, slug, attempt + 1);
        }
      }
      throw err;
    }
  }
}

// Tipos mínimos do payload da Kick API v1
interface KickApiChannelResponse {
  id: number;
  slug: string;
  chatroom: { id: number; chatable_id: number };
  livestream?: {
    is_live: boolean;
    viewer_count: number;
    session_title?: string;
  };
}
