/**
 * KCK-02 · KickPusherProvider — ChatProvider via Pusher Channels.
 *
 * Kick usa Pusher self-hosted. Canal: chatrooms.{chatroomId}.v2 (privado,
 * requer auth endpoint). Eventos vinculados:
 *  - App\Events\ChatMessageEvent     → emite RawMessage
 *  - App\Events\MessageDeletedEvent  → lifecycle message_deleted
 *  - App\Events\StreamerIsLive       → lifecycle connected (online)
 *  - App\Events\StopStreamBroadcast  → lifecycle disconnected (offline)
 *
 * O chatroomId é resolvido via KickRestClient (KCK-04) no connect().
 * Por ora aceita chatroomId direto no ctor para não bloquear a implementação.
 *
 * Error recovery: auth 401 → chama tokenService.getValidToken + reconecta,
 * até MAX_RECONNECTS vezes com backoff exponencial.
 */
import Pusher from 'pusher-js';
import type { Channel as PusherChannel } from 'pusher-js';
import type {
  Channel,
  ChatProvider,
  ChatProviderConfig,
  EmoteDictionary,
  LifecycleEvent,
  RawMessage,
} from '@sehloro/domain';
import { KickChatMessageEvent, KickMessageMapper } from './kick-message.mapper';
import type { KickRestClient } from './kick-rest.client';

// APP_KEY público do Kick (capturado via DevTools — ver TESTING.md).
const KICK_PUSHER_APP_KEY = '32cbd69e4b950bf97679';
const KICK_PUSHER_CLUSTER = 'us2';
const MAX_RECONNECTS = 3;

export interface KickPusherConfig {
  /** ID da chatroom Kick (campo chatroom.id da Kick REST API). */
  chatroomId: string | number;
  /** URL base da API para o auth endpoint do Pusher (private channels). */
  apiBaseUrl?: string;
}

/**
 * Serviço mínimo de token Kick. KickOAuthService implementa isto.
 * Mantemos como interface para evitar acoplamento direto ao apps/api.
 */
export interface KickTokenService {
  getValidToken(channelId: string): Promise<string>;
}

export class KickPusherProvider implements ChatProvider {
  readonly config: ChatProviderConfig;

  private pusher: InstanceType<typeof Pusher> | null = null;
  private pusherChannel: PusherChannel | null = null;
  private readonly msgHandlers: Array<(m: RawMessage) => void> = [];
  private readonly lcHandlers: Array<(e: LifecycleEvent) => void> = [];
  private lastMessageAt: Date | undefined;
  private reconnectCount = 0;

  constructor(
    private readonly channel: Channel,
    private readonly kickConfig: KickPusherConfig,
    private readonly tokenService?: KickTokenService,
    private readonly emoteDictionary?: EmoteDictionary,
    private readonly restClient?: KickRestClient,
  ) {
    this.config = {
      platform: 'kick',
      channelExternalId: String(kickConfig.chatroomId),
      channelName: channel.getName(),
      credentials: {},
    };
  }

  async connect(): Promise<void> {
    if (this.pusher) return;

    const accessToken = await this.tokenService
      ?.getValidToken(this.channel.getId())
      .catch(() => undefined);

    const pusherOptions: ConstructorParameters<typeof Pusher>[1] = {
      cluster: KICK_PUSHER_CLUSTER,
      forceTLS: true,
    };

    if (accessToken && this.kickConfig.apiBaseUrl) {
      pusherOptions.channelAuthorization = {
        endpoint: `${this.kickConfig.apiBaseUrl}/api/v2/ingestion/kick/auth`,
        transport: 'ajax',
        headers: { Authorization: `Bearer ${accessToken}` },
      };
    }

    this.pusher = new Pusher(KICK_PUSHER_APP_KEY, pusherOptions);

    this._bindConnectionEvents();

    const channelName = `chatrooms.${this.kickConfig.chatroomId}.v2`;
    this.pusherChannel = this.pusher.subscribe(channelName);

    this._bindChannelEvents();
  }

  async disconnect(): Promise<void> {
    if (!this.pusherChannel) return;
    this.pusherChannel.unbind_all();
    this.pusherChannel = null;
    this.pusher?.disconnect();
    this.pusher = null;
    this.reconnectCount = 0;
  }

  onMessage(handler: (msg: RawMessage) => void): () => void {
    this.msgHandlers.push(handler);
    return () => {
      const i = this.msgHandlers.indexOf(handler);
      if (i !== -1) this.msgHandlers.splice(i, 1);
    };
  }

  onLifecycle(handler: (evt: LifecycleEvent) => void): () => void {
    this.lcHandlers.push(handler);
    return () => {
      const i = this.lcHandlers.indexOf(handler);
      if (i !== -1) this.lcHandlers.splice(i, 1);
    };
  }

  async getViewerCount(): Promise<number | null> {
    if (!this.restClient) return null;
    try {
      const stream = await this.restClient.getStream(this.channel.getName());
      return stream.viewerCount;
    } catch {
      return null;
    }
  }

  async healthz(): Promise<{
    alive: boolean;
    lastMessageAt?: Date;
    details?: Record<string, unknown>;
  }> {
    const state = this.pusher?.connection?.state ?? 'disconnected';
    return {
      alive: state === 'connected',
      lastMessageAt: this.lastMessageAt,
      details: { connectionState: state },
    };
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  private _bindConnectionEvents(): void {
    if (!this.pusher) return;

    this.pusher.connection.bind('connected', () => {
      this.reconnectCount = 0;
      this._emitLifecycle({ type: 'connected', ts: new Date() });
    });

    this.pusher.connection.bind('disconnected', () => {
      this._emitLifecycle({ type: 'disconnected', ts: new Date() });
    });

    this.pusher.connection.bind('connecting', () => {
      this._emitLifecycle({ type: 'reconnecting', ts: new Date() });
    });

    // 4006 = auth error no Pusher.
    this.pusher.connection.bind(
      'error',
      (err: { type: string; error?: { data?: { code?: number } } }) => {
        const code = err?.error?.data?.code;
        if (code === 4006 && this.reconnectCount < MAX_RECONNECTS) {
          this._handleAuthError();
        }
      },
    );
  }

  private _bindChannelEvents(): void {
    if (!this.pusherChannel) return;

    this.pusherChannel.bind('App\\Events\\ChatMessageEvent', (data: KickChatMessageEvent) => {
      const raw = KickMessageMapper.toRaw(
        data,
        this.channel.getName(),
        this.kickConfig.chatroomId,
        this.emoteDictionary,
      );
      this.lastMessageAt = raw.receivedAt;
      for (const h of [...this.msgHandlers]) h(raw);
    });

    this.pusherChannel.bind(
      'App\\Events\\MessageDeletedEvent',
      (data: { message?: { id?: string } }) => {
        this._emitLifecycle({
          type: 'message_deleted',
          ts: new Date(),
          targetMessageId: data?.message?.id,
        });
      },
    );

    this.pusherChannel.bind('App\\Events\\StreamerIsLive', () => {
      this._emitLifecycle({ type: 'connected', ts: new Date(), reason: 'stream_online' });
    });

    this.pusherChannel.bind('App\\Events\\StopStreamBroadcast', () => {
      this._emitLifecycle({ type: 'disconnected', ts: new Date(), reason: 'stream_offline' });
    });
  }

  private async _handleAuthError(): Promise<void> {
    this.reconnectCount++;
    const backoffMs = Math.pow(2, this.reconnectCount) * 500;
    await new Promise((r) => setTimeout(r, backoffMs));

    // Desconecta e reconecta com token fresco.
    await this.disconnect();
    await this.connect();
  }

  private _emitLifecycle(evt: LifecycleEvent): void {
    for (const h of [...this.lcHandlers]) h(evt);
  }
}
