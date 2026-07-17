/**
 * CON-03 · TwitchEventSubWsClient — receptor de shard via WebSocket.
 *
 * Conecta em wss://eventsub.wss.twitch.tv/ws, recebe session_welcome com
 * session_id, e usa esse session_id para chamar TwitchConduitService.assignShards
 * — ligando este shard ao conduit central da aplicação. A partir daí, todos
 * os notification para subscriptions atribuídas a este shard chegam pelo socket.
 *
 * Mensagens do EventSub WS:
 *  - session_welcome   — primeiro frame após conectar; contém session_id
 *  - session_keepalive — a cada 10s; serve para detectar zumbi
 *  - notification      — subscription.type + event (channel.chat.message, stream.online, ...)
 *  - session_reconnect — força reconexão em uma URL nova (mantém shard)
 *  - revocation        — subscription deixou de funcionar (auth revoked, user removed, ...)
 *
 * Heartbeat: se passar `heartbeatTimeoutMs` (default 15s — keepalive é 10s)
 * sem nenhum frame válido, fecha o socket e tenta reconectar com backoff.
 *
 * Reconexão: backoff exponencial base 500ms, max 30s. Sucesso reseta o backoff.
 *
 * Injeção: o construtor recebe `wsFactory` para que tests passem um mock no
 * lugar do `new WebSocket(url)` da lib `ws`. O default usa a lib real.
 */
import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';

export const DEFAULT_EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
export const HEARTBEAT_TIMEOUT_MS = 15_000;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;

/** Subset do ws.WebSocket que o client usa — facilita o mock em testes. */
export interface WsLike {
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: Buffer | string) => void): this;
  on(event: 'close', listener: (code?: number, reason?: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export type WsFactory = (url: string) => WsLike;

/** Sinks que o worker preenche com as implementações reais. */
export interface TwitchEventSubWsHandlers {
  /** Chamado com o session_id assim que o welcome chega — atribua o shard aqui. */
  onWelcome: (sessionId: string) => Promise<void>;
  /** Notification de algum tipo de subscription. */
  onNotification: (payload: TwitchEventSubNotification) => void;
  /** Subscription revogada — registrar + alertar. */
  onRevocation: (payload: TwitchEventSubRevocation) => void;
  /** (Opcional) callback para keepalive — útil em métricas. */
  onKeepalive?: () => void;
}

export interface TwitchEventSubNotification {
  subscription: {
    id: string;
    type: string;
    version: string;
    status: string;
    condition: Record<string, string>;
  };
  event: Record<string, unknown>;
}

export interface TwitchEventSubRevocation {
  subscription: {
    id: string;
    type: string;
    status: string;
  };
}

interface WsMessageEnvelope {
  metadata: {
    message_id: string;
    message_type:
      | 'session_welcome'
      | 'session_keepalive'
      | 'notification'
      | 'session_reconnect'
      | 'revocation';
    message_timestamp: string;
    subscription_type?: string;
    subscription_version?: string;
  };
  payload: Record<string, unknown>;
}

export class TwitchEventSubWsClient extends EventEmitter {
  private readonly logger = new Logger(TwitchEventSubWsClient.name);
  private ws: WsLike | null = null;
  private url: string;
  private sessionId: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private closing = false;

  constructor(
    private readonly handlers: TwitchEventSubWsHandlers,
    private readonly wsFactory: WsFactory,
    options: { url?: string } = {},
  ) {
    super();
    this.url = options.url ?? DEFAULT_EVENTSUB_WS_URL;
  }

  /** Conecta. Em erro/close, faz reconexão com backoff até `close()` ser chamado. */
  connect(): void {
    if (this.closing) return;

    this.logger.log(`Conectando em ${this.url}`);
    const socket = this.wsFactory(this.url);
    this.ws = socket;

    socket.on('open', () => {
      this.logger.log('WS aberto, aguardando session_welcome');
    });

    socket.on('message', (raw) => {
      // Socket antigo pós-handoff de session_reconnect: ignora frames tardios.
      if (this.ws !== socket) return;
      this._resetHeartbeat();
      this._handleFrame(raw);
    });

    socket.on('close', (code, reason) => {
      this.logger.warn(`WS fechou (code=${code} reason=${reason?.toString() ?? '-'})`);
      // Close do socket ANTIGO do handoff (session_reconnect): o novo já está
      // vivo — reagendar aqui criava uma 2ª conexão na reconnect_url já usada,
      // que a Twitch rejeita com 4007 em loop infinito.
      if (this.ws !== socket) return;
      this._clearHeartbeat();
      if (!this.closing) {
        // reconnect_url é de uso único — qualquer retry volta pra URL base
        // (welcome novo → onWelcome reatribui o shard ao conduit).
        this.url = DEFAULT_EVENTSUB_WS_URL;
        this._scheduleReconnect();
      }
    });

    socket.on('error', (err) => {
      this.logger.error('WS error', err.stack ?? err.message);
    });
  }

  /** Encerra graciosamente — não reconecta. */
  close(): void {
    this.closing = true;
    this._clearHeartbeat();
    this.ws?.close(1000, 'client closing');
    this.ws = null;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  // ─── parsing + dispatching ───────────────────────────────────────────────

  private _handleFrame(raw: Buffer | string): void {
    let env: WsMessageEnvelope;
    try {
      env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as WsMessageEnvelope;
    } catch (err) {
      this.logger.error('Frame inválido (não-JSON)', (err as Error).message);
      return;
    }

    switch (env.metadata?.message_type) {
      case 'session_welcome':
        return this._handleWelcome(env.payload);
      case 'session_keepalive':
        this.handlers.onKeepalive?.();
        return;
      case 'notification':
        return this._handleNotification(env.payload);
      case 'session_reconnect':
        return this._handleReconnect(env.payload);
      case 'revocation':
        return this._handleRevocation(env.payload);
      default:
        this.logger.warn(`message_type desconhecido: ${env.metadata?.message_type}`);
    }
  }

  private _handleWelcome(payload: Record<string, unknown>): void {
    const session = payload?.session as
      | { id?: string; keepalive_timeout_seconds?: number }
      | undefined;
    if (!session?.id) {
      this.logger.error('session_welcome sem session.id');
      return;
    }
    this.sessionId = session.id;
    this.reconnectAttempts = 0; // welcome = conexão saudável
    this._resetHeartbeat(); // primeiro tick — o keepalive vem em ~10s
    this.logger.log(`session_welcome recebido: ${this.sessionId}`);

    Promise.resolve(this.handlers.onWelcome(this.sessionId)).catch((err) =>
      this.logger.error('onWelcome handler falhou', (err as Error).stack),
    );
  }

  private _handleNotification(payload: Record<string, unknown>): void {
    this.handlers.onNotification(payload as unknown as TwitchEventSubNotification);
  }

  private _handleRevocation(payload: Record<string, unknown>): void {
    this.handlers.onRevocation(payload as unknown as TwitchEventSubRevocation);
  }

  private _handleReconnect(payload: Record<string, unknown>): void {
    const session = payload?.session as { reconnect_url?: string } | undefined;
    if (!session?.reconnect_url) {
      this.logger.error('session_reconnect sem reconnect_url');
      return;
    }
    this.logger.log(`session_reconnect — trocando URL para ${session.reconnect_url}`);
    this.url = session.reconnect_url;

    // Fechar o socket antigo NÃO dispara reconnect porque o novo já foi
    // estabelecido pela URL nova — mas precisamos coordenar a ordem.
    const previousWs = this.ws;
    this.ws = null;
    this.connect();
    previousWs?.close(1000, 'session_reconnect');
  }

  // ─── heartbeat ───────────────────────────────────────────────────────────

  private _resetHeartbeat(): void {
    this._clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.logger.warn(
        `Heartbeat estourou (${HEARTBEAT_TIMEOUT_MS}ms sem frame) — forçando reconnect`,
      );
      this.ws?.close(4000, 'heartbeat timeout');
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private _clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── reconnect com backoff ───────────────────────────────────────────────

  private _scheduleReconnect(): void {
    this.reconnectAttempts++;
    const base = BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = Math.random() * base * 0.3;
    const delay = Math.min(base + jitter, BACKOFF_MAX_MS);
    this.logger.log(
      `Reagendando reconnect em ${Math.round(delay)}ms (tentativa ${this.reconnectAttempts})`,
    );
    setTimeout(() => {
      if (!this.closing) this.connect();
    }, delay);
  }
}
