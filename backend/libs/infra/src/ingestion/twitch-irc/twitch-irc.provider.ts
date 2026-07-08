/**
 * TWI-01 · TwitchIrcProvider — wrapper tmi.js para o ChatProvider port.
 *
 * Porta o padrão dos bots legados (Bot_SocialListening, Riotgames) para o
 * contrato ChatProvider. Principais diferenças em relação aos bots:
 * - accessToken descriptografado via CryptoService (AES-256-GCM) em connect()
 * - Conversão completa userstate → RawMessage (emotes, badges, mentions)
 * - LifecycleEvent emitido para connected/disconnected/reconnecting/rate_limited/message_deleted
 * - Sem lógica de negócio aqui — só normalização do protocolo IRC
 *
 * Nota: getViewerCount() é stub neste milestone (TWI-03 implementa via Helix).
 */
import * as tmi from 'tmi.js';
import {
  Channel,
  ChannelOAuthToken,
  ChatProvider,
  ChatProviderConfig,
  EmoteDictionary,
  LifecycleEvent,
  RawMessage,
} from '@sehloro/domain';
import { CryptoService } from '../../crypto/crypto.service';
import { TwitchMessageMapper } from './twitch-message.mapper';
import { TwitchTokenRefresher } from './twitch-token-refresher';

export class TwitchIrcProvider implements ChatProvider {
  readonly config: ChatProviderConfig;

  private client: tmi.Client | null = null;
  private readonly msgHandlers: Array<(m: RawMessage) => void> = [];
  private readonly lcHandlers: Array<(e: LifecycleEvent) => void> = [];
  private lastMessageAt: Date | undefined;

  constructor(
    private oauthToken: ChannelOAuthToken,
    private readonly channel: Channel,
    private readonly cryptoService: CryptoService,
    private readonly tokenRefresher?: TwitchTokenRefresher,
    private readonly emoteDictionary?: EmoteDictionary,
  ) {
    this.config = {
      platform: 'twitch',
      channelExternalId: channel.getExternalId() ?? channel.getName(),
      channelName: channel.getName(),
      credentials: {},
    };
  }

  async connect(): Promise<void> {
    if (this.client) return;

    // TWI-04: renova token se necessário antes de conectar
    if (this.tokenRefresher) {
      this.oauthToken = await this.tokenRefresher.refreshIfNeeded(this.oauthToken);
    }

    const accessToken = this.cryptoService.decryptField(this.oauthToken.getAccessToken());
    if (!accessToken) {
      throw new Error(
        `[TwitchIrcProvider] accessToken inválido para canal ${this.channel.getName()}`,
      );
    }

    const channelName = this.channel.getName().toLowerCase();

    this.client = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: { username: 'ModiaBot', password: `oauth:${accessToken}` },
      channels: [`#${channelName}`],
    });

    this._registerClientEvents(channelName);

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    await c.disconnect();
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

  /** Stub — TWI-03 implementa via Helix polling. */
  async getViewerCount(): Promise<number | null> {
    return null;
  }

  async healthz(): Promise<{
    alive: boolean;
    lastMessageAt?: Date;
    details?: Record<string, unknown>;
  }> {
    const readyState = this.client?.readyState() ?? 'CLOSED';
    return {
      alive: readyState === 'OPEN',
      lastMessageAt: this.lastMessageAt,
      details: { readyState },
    };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private _registerClientEvents(channelName: string): void {
    if (!this.client) return;

    this.client.on('connected', () => {
      this._emitLifecycle({ type: 'connected', ts: new Date() });
    });

    this.client.on('disconnected', (reason) => {
      this._emitLifecycle({ type: 'disconnected', ts: new Date(), reason });
    });

    this.client.on('reconnect', () => {
      this._emitLifecycle({ type: 'reconnecting', ts: new Date() });
    });

    this.client.on('notice', (_channel, msgid) => {
      if (msgid === 'msg_banned' || msgid === 'msg_channel_suspended') {
        this._emitLifecycle({
          type: 'rate_limited',
          ts: new Date(),
          reason: msgid,
        });
      }
    });

    this.client.on('messagedeleted', (_channel, _username, _deletedMessage, userstate) => {
      this._emitLifecycle({
        type: 'message_deleted',
        ts: new Date(),
        targetMessageId: userstate['target-msg-id'] ?? undefined,
      });
    });

    this.client.on('message', (_channel, userstate, message, self) => {
      if (self) return;
      const raw = TwitchMessageMapper.toRaw(userstate, channelName, message, this.emoteDictionary);
      this.lastMessageAt = raw.receivedAt;
      for (const h of [...this.msgHandlers]) h(raw);
    });
  }

  private _emitLifecycle(evt: LifecycleEvent): void {
    for (const h of [...this.lcHandlers]) h(evt);
  }
}
