/**
 * KCK-04 · KickRestClient.
 *
 * Descobre chatroomId e status de live de canais Kick. Estratégia em camadas,
 * porque o endpoint clássico (kick.com/api/v1|v2 — não-oficial) fica atrás de
 * WAF Cloudflare que bloqueia IPs de datacenter com 403 "Request blocked by
 * security policy" (bloqueio por IP: até Chrome real do mesmo host recebe 403):
 *
 *  1. não-oficial direto (kick.com/api/v1/channels/{slug}) — dá tudo de uma
 *     vez (chatroom.id + livestream) quando o IP não está bloqueado;
 *  2. API OFICIAL (api.kick.com/public/v1, app token client_credentials) —
 *     dá broadcaster_user_id + is_live/viewer_count, mas NÃO expõe o
 *     chatroom.id que o Pusher (`chatrooms.{id}.v2`) exige;
 *  3. chatroomId por CADEIA de fallbacks (ver `_resolveChatroomId`):
 *       a. override estático do operador (`KICK_CHATROOM_IDS=slug:id,...`)
 *       b. store persistente (Redis) — resolvido 1× na vida do canal,
 *          sobrevive a restart (o id não muda na prática)
 *       c. endpoint não-oficial direto (quando o IP não está bloqueado)
 *       d. proxies externos (`KICK_CHATROOM_PROXY`, CSV de templates com
 *          `{url}`) na ordem configurada — com o proxy público do Jina
 *          SEMPRE apensado como ÚLTIMO recurso da cadeia.
 *     Racional: o Jina (r.jina.ai) é serviço gratuito de terceiro — não pode
 *     ser o caminho primário de um dado de produção; a cadeia garante que ele
 *     só é consultado quando tudo que controlamos falhou.
 *
 * Cache em memória por slug:
 *  - getChannel: TTL 30 s (status de live muda; chatroomId raramente)
 *  - chatroomId: permanente (não muda na prática)
 *
 * Retorna null em 404. Lança KickApiTimeoutError em timeout de 5 s.
 * Backoff exponencial (3 retries) em 429/5xx via axios-retry inline.
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Injectable, Logger } from '@nestjs/common';

const KICK_API_BASE = 'https://kick.com/api/v1';
const KICK_CHATROOM_URL = (slug: string) =>
  `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/chatroom`;
const KICK_OFFICIAL_API_BASE = 'https://api.kick.com/public/v1';
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const REQUEST_TIMEOUT_MS = 5_000;
const PROXY_TIMEOUT_MS = 25_000; // fetchers externos renderizam além de buscar
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

const CACHE_TTL_CHANNEL_MS = 30_000;
const CACHE_TTL_STREAM_MS = 15_000;
const TOKEN_EXPIRY_SLACK_MS = 60_000;

export class KickApiTimeoutError extends Error {
  constructor(slug: string) {
    super(`Kick API timeout para slug "${slug}"`);
    this.name = 'KickApiTimeoutError';
  }
}

/**
 * Proxy público do Jina — ÚLTIMO recurso da cadeia de resolução. Fica
 * apensado ao fim da lista configurada (sem duplicar se o operador já o
 * listou), para que um proxy próprio configurado em KICK_CHATROOM_PROXY
 * seja sempre tentado antes.
 */
export const JINA_PROXY_TEMPLATE = 'https://r.jina.ai/{url}';

/**
 * `KICK_CHATROOM_PROXY` (CSV de templates) → lista ordenada de proxies com o
 * Jina garantido na última posição. Exportado para teste.
 */
export function resolveProxyChain(csv?: string): string[] {
  const configured = (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!configured.includes(JINA_PROXY_TEMPLATE)) configured.push(JINA_PROXY_TEMPLATE);
  return configured;
}

/**
 * `KICK_CHATROOM_IDS` ("slug:id,slug2:id2") → mapa de overrides estáticos do
 * operador. Entradas malformadas são ignoradas. Exportado para teste.
 */
export function parseStaticChatroomIds(csv?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of (csv ?? '').split(',')) {
    const [slug, id] = pair.split(':').map((s) => s.trim());
    if (slug && id && /^\d+$/.test(id)) out[slug.toLowerCase()] = Number(id);
  }
  return out;
}

/** Store persistente do chatroomId (Redis em produção) — sobrevive a restart. */
export interface ChatroomIdStore {
  get(slug: string): Promise<number | null>;
  set(slug: string, id: number): Promise<void>;
}

/** Superfície mínima do ioredis usada pelo store (evita depender do tipo Redis aqui). */
export interface RedisChatroomStoreClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

const CHATROOM_STORE_PREFIX = 'kick:chatroomid:';

/**
 * Store Redis do chatroomId — SEM TTL de propósito: o id é estável (só muda
 * se o canal for recriado) e é exatamente o dado que não queremos re-resolver
 * via proxy a cada restart. Homolog roda Redis com AOF → sobrevive a reboot.
 */
export function makeRedisChatroomIdStore(redis: RedisChatroomStoreClient): ChatroomIdStore {
  return {
    async get(slug: string): Promise<number | null> {
      const raw = await redis.get(CHATROOM_STORE_PREFIX + slug.toLowerCase());
      return raw && /^\d+$/.test(raw) ? Number(raw) : null;
    },
    async set(slug: string, id: number): Promise<void> {
      await redis.set(CHATROOM_STORE_PREFIX + slug.toLowerCase(), String(id));
    },
  };
}

export interface KickRestClientOptions {
  /** Credenciais do app Kick — habilitam o fallback pela API oficial. */
  clientId?: string;
  clientSecret?: string;
  /**
   * CSV de templates de fetchers externos para resolver o chatroomId quando o
   * endpoint não-oficial está bloqueado por WAF. `{url}` é substituído pela
   * URL alvo; tentados NA ORDEM. O proxy do Jina é sempre apensado como
   * último recurso (ver `resolveProxyChain`).
   */
  chatroomProxy?: string;
  /** Overrides estáticos slug→chatroomId (KICK_CHATROOM_IDS) — vencem tudo. */
  staticChatroomIds?: Record<string, number>;
  /** Store persistente (Redis) — evita re-resolver após restart. */
  store?: ChatroomIdStore;
}

export interface KickChannelResult {
  /** channel id (rota não-oficial) OU broadcaster_user_id (rota oficial). */
  id: number;
  slug: string;
  /** null quando irresolvível (WAF bloqueando e sem proxy configurado). */
  chatroomId: number | null;
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
  /** chatroomId por slug — permanente (só muda se o canal for recriado). */
  private readonly chatroomIdCache = new Map<string, number>();
  private readonly options: KickRestClientOptions;
  private appToken: { value: string; expiresAt: number } | null = null;

  constructor(options: KickRestClientOptions = {}) {
    this.options = options;
    this.http = axios.create({
      baseURL: KICK_API_BASE,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  async getChannel(slug: string): Promise<KickChannelResult | null> {
    const cached = this.channelCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let result: KickChannelResult | null;
    try {
      result = await this._fetchWithRetry<KickChannelResult | null>(
        () => this._fetchChannel(slug),
        slug,
      );
      // Persiste também no store: o restart não volta a depender de proxy.
      if (result?.chatroomId != null) this._commitChatroomId(slug, result.chatroomId);
    } catch (err) {
      // 403/timeout/rede na rota não-oficial → tenta a API oficial.
      result = await this._fetchChannelOfficial(slug, err as Error);
    }
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

  // ─── Fallback: API oficial + proxy p/ chatroomId ───────────────────────────

  private async _fetchChannelOfficial(
    slug: string,
    unofficialError: Error,
  ): Promise<KickChannelResult | null> {
    if (!this.options.clientId || !this.options.clientSecret) {
      throw unofficialError; // sem credenciais não há fallback — propaga o erro original
    }

    const token = await this._getAppToken();
    const { data } = await axios.get<KickOfficialChannelsResponse>(
      `${KICK_OFFICIAL_API_BASE}/channels`,
      {
        params: { slug },
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );

    const ch = data?.data?.[0];
    if (!ch) return null;

    const chatroomId = await this._resolveChatroomId(slug);
    if (chatroomId == null) {
      this.logger.warn(
        `Kick "${slug}": rota não-oficial bloqueada (${unofficialError.message}) e a cadeia ` +
          `de resolução do chatroomId falhou inteira (direto + proxies, incl. Jina)`,
      );
    }

    return {
      id: ch.broadcaster_user_id,
      slug: ch.slug,
      chatroomId,
      isLive: ch.stream?.is_live ?? false,
      viewerCount: ch.stream?.viewer_count ?? null,
      title: ch.stream_title || undefined,
    };
  }

  private async _getAppToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now()) return this.appToken.value;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId!,
      client_secret: this.options.clientSecret!,
    });
    const { data } = await axios.post<{ access_token: string; expires_in: number }>(
      KICK_TOKEN_URL,
      body.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REQUEST_TIMEOUT_MS,
      },
    );
    this.appToken = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_SLACK_MS,
    };
    return data.access_token;
  }

  /**
   * chatroomId por cadeia de fallbacks, do mais confiável/controlado para o
   * menos: memória → override estático → store persistente → endpoint direto
   * → proxies (na ordem configurada, Jina SEMPRE por último). Resultado
   * positivo é cacheado em memória e persistido no store (o id não muda).
   */
  private async _resolveChatroomId(slug: string): Promise<number | null> {
    // 0. memória do processo
    const cached = this.chatroomIdCache.get(slug);
    if (cached != null) return cached;

    // 1. override estático do operador (KICK_CHATROOM_IDS) — vence tudo.
    const pinned = this.options.staticChatroomIds?.[slug.toLowerCase()];
    if (pinned != null) {
      this.chatroomIdCache.set(slug, pinned);
      return pinned;
    }

    // 2. store persistente (Redis) — resolvido numa vida anterior do processo.
    if (this.options.store) {
      try {
        const stored = await this.options.store.get(slug);
        if (stored != null) {
          this.chatroomIdCache.set(slug, stored);
          return stored;
        }
      } catch (err) {
        this.logger.warn(`store de chatroomId falhou (get "${slug}"): ${(err as Error).message}`);
      }
    }

    const target = KICK_CHATROOM_URL(slug);

    // 3. endpoint não-oficial direto (funciona quando o IP não está no WAF).
    try {
      const { data } = await axios.get<{ id: number }>(target, { timeout: REQUEST_TIMEOUT_MS });
      if (typeof data?.id === 'number') {
        return this._commitChatroomId(slug, data.id);
      }
    } catch {
      // bloqueado — cadeia de proxies abaixo
    }

    // 4. proxies externos NA ORDEM configurada; Jina apensado como último.
    for (const proxy of resolveProxyChain(this.options.chatroomProxy)) {
      try {
        const url = proxy.includes('{url}') ? proxy.replace('{url}', target) : `${proxy}${target}`;
        const { data } = await axios.get<string>(url, {
          timeout: PROXY_TIMEOUT_MS,
          responseType: 'text',
          transformResponse: [(d: string) => d],
        });
        const id = this._extractChatroomId(String(data));
        if (id != null) return this._commitChatroomId(slug, id);
        this.logger.warn(`proxy de chatroom não retornou id para "${slug}" (${proxy})`);
      } catch (err) {
        this.logger.warn(
          `proxy de chatroom falhou para "${slug}" (${proxy}): ${(err as Error).message}`,
        );
      }
    }

    // Cadeia INTEIRA falhou — sem chatroomId não há ingestão de chat Kick
    // deste canal. error (não warn): é indisponibilidade de feature, o
    // operador precisa ver (e pode destravar na hora via KICK_CHATROOM_IDS).
    this.logger.error(
      `chatroomId irresolvível para "${slug}": endpoint direto e todos os proxies falharam — ` +
        `ingestão Kick deste canal está PARADA. Destrave imediato: KICK_CHATROOM_IDS=${slug}:<id>`,
    );
    return null;
  }

  /** Grava o id resolvido na memória e (best-effort) no store persistente. */
  private _commitChatroomId(slug: string, id: number): number {
    this.chatroomIdCache.set(slug, id);
    void this.options.store
      ?.set(slug, id)
      .catch((err: Error) =>
        this.logger.warn(`store de chatroomId falhou (set "${slug}"): ${err.message}`),
      );
    return id;
  }

  /**
   * Fetchers externos embrulham o JSON em texto (markdown etc.) — extrai o
   * primeiro objeto `{"id": <número>` de forma leniente.
   */
  private _extractChatroomId(text: string): number | null {
    const match = /\{\s*"id"\s*:\s*(\d+)/.exec(text);
    return match ? Number(match[1]) : null;
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

// Tipos mínimos do payload da Kick API v1 (não-oficial)
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

// Tipos mínimos da Kick public API oficial (api.kick.com/public/v1)
interface KickOfficialChannelsResponse {
  data: Array<{
    broadcaster_user_id: number;
    slug: string;
    stream_title?: string;
    stream?: { is_live: boolean; viewer_count: number };
  }>;
}
