/**
 * CHAT-04 · MockChatProvider com replay de fixtures.
 *
 * Implementação de ChatProvider para testes determinísticos. Carrega mensagens
 * de um arquivo JSON ou de um array inline e as emite em connect() respeitando
 * timestamps relativos entre as mensagens.
 *
 * scale=0  → dump instantâneo: todas as mensagens emitidas sincronamente no connect()
 * scale=1  → tempo real: delays entre mensagens conforme diferença de receivedAt
 * scale=N  → N vezes mais rápido que tempo real (delays / N)
 */
import { readFileSync } from 'node:fs';
import { ChatProvider, ChatProviderConfig, LifecycleEvent, RawMessage } from '@sehloro/domain';

type FixtureFile = {
  viewerCount?: number;
  messages: RawMessageRaw[];
};

/** Shape do JSON no disco — receivedAt vem como string ISO. */
type RawMessageRaw = Omit<RawMessage, 'receivedAt'> & { receivedAt: string };

export interface MockChatProviderOptions {
  /** 0=dump instantâneo, 1=tempo real, N=N× mais rápido. Default: 0. */
  scale?: number;
  viewerCount?: number;
}

export class MockChatProvider implements ChatProvider {
  private readonly msgHandlers: Array<(m: RawMessage) => void> = [];
  private readonly lcHandlers: Array<(e: LifecycleEvent) => void> = [];
  private connected = false;
  private lastMessageAt: Date | undefined;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly scale: number;

  messages: RawMessage[] = [];
  fixtureViewerCount: number | null = null;

  constructor(
    public readonly config: ChatProviderConfig,
    options: MockChatProviderOptions = {},
  ) {
    this.scale = options.scale ?? 0;
    this.fixtureViewerCount = options.viewerCount ?? null;
  }

  /**
   * Cria um MockChatProvider carregando fixture de um arquivo JSON.
   * O JSON deve ter o shape `{ viewerCount?: number, messages: RawMessage[] }`
   * com `receivedAt` como string ISO.
   */
  static fromFile(
    filePath: string,
    config: Partial<ChatProviderConfig> = {},
    options: MockChatProviderOptions = {},
  ): MockChatProvider {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as FixtureFile;
    const messages = parseMessages(raw.messages);
    const provider = new MockChatProvider(buildConfig(config, messages[0]), {
      ...options,
      viewerCount: options.viewerCount ?? raw.viewerCount,
    });
    provider.messages = messages;
    provider.fixtureViewerCount = options.viewerCount ?? raw.viewerCount ?? null;
    return provider;
  }

  /**
   * Cria um MockChatProvider a partir de um array inline.
   * Ideal para testes unitários rápidos sem arquivo em disco.
   */
  static fromArray(
    msgs: RawMessage[],
    options: MockChatProviderOptions & { config?: Partial<ChatProviderConfig> } = {},
  ): MockChatProvider {
    const { config: configOverride, ...providerOpts } = options;
    const provider = new MockChatProvider(buildConfig(configOverride ?? {}, msgs[0]), providerOpts);
    provider.messages = [...msgs];
    return provider;
  }

  /** Cria uma RawMessage mínima válida para uso em testes inline. */
  static makeMessage(overrides: Partial<RawMessage> = {}): RawMessage {
    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      platform: 'twitch',
      channelExternalId: 'testchannel',
      channelName: 'testchannel',
      user: {
        externalId: 'u1',
        username: 'testuser',
        displayName: 'TestUser',
        isSubscriber: false,
        isMod: false,
        isBroadcaster: false,
        badges: [],
      },
      text: 'hello',
      emotes: [],
      mentions: [],
      rawPayload: null,
      receivedAt: new Date(),
      ...overrides,
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.connected = true;
    this._emitLifecycle({ type: 'connected', ts: new Date() });
    this._scheduleMessages();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this._clearTimers();
    this._emitLifecycle({ type: 'disconnected', ts: new Date() });
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
    return this.fixtureViewerCount;
  }

  async healthz(): Promise<{
    alive: boolean;
    lastMessageAt?: Date;
    details?: Record<string, unknown>;
  }> {
    return {
      alive: this.connected,
      lastMessageAt: this.lastMessageAt,
      details: { scale: this.scale, messageCount: this.messages.length },
    };
  }

  // ─── helpers de teste ────────────────────────────────────────────────────

  /** Emite uma mensagem diretamente para todos os handlers registrados. */
  emit(msg: RawMessage): void {
    this._emitMessage(msg);
  }

  /** Emite um LifecycleEvent diretamente para todos os handlers registrados. */
  emitLifecycle(evt: LifecycleEvent): void {
    this._emitLifecycle(evt);
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private _scheduleMessages(): void {
    if (this.messages.length === 0) return;

    const sorted = [...this.messages].sort(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
    );

    if (this.scale === 0) {
      for (const msg of sorted) this._emitMessage(msg);
      return;
    }

    const baseTs = sorted[0].receivedAt.getTime();
    for (const msg of sorted) {
      const delta = msg.receivedAt.getTime() - baseTs;
      const delay = Math.round(delta / this.scale);
      if (delay === 0) {
        // Delay zero → emite síncronamente para não depender de microtask
        this._emitMessage(msg);
      } else {
        const t = setTimeout(() => this._emitMessage(msg), delay);
        this.timers.push(t);
      }
    }
  }

  private _emitMessage(msg: RawMessage): void {
    this.lastMessageAt = msg.receivedAt;
    for (const h of [...this.msgHandlers]) h(msg);
  }

  private _emitLifecycle(evt: LifecycleEvent): void {
    for (const h of [...this.lcHandlers]) h(evt);
  }

  private _clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

// ─── helpers de parsing ──────────────────────────────────────────────────────

function parseMessages(raws: RawMessageRaw[]): RawMessage[] {
  return raws.map((r) => ({ ...r, receivedAt: new Date(r.receivedAt) }));
}

function buildConfig(
  override: Partial<ChatProviderConfig>,
  firstMsg?: RawMessage,
): ChatProviderConfig {
  return {
    platform: override.platform ?? firstMsg?.platform ?? 'twitch',
    channelExternalId: override.channelExternalId ?? firstMsg?.channelExternalId ?? 'mock',
    channelName: override.channelName ?? firstMsg?.channelName ?? 'mock',
    credentials: override.credentials ?? {},
  };
}
