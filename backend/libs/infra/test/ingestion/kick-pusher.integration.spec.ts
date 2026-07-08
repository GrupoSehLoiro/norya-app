/**
 * KCK-05 · KickPusherProvider — teste de integração contra canal real Kick.
 *
 * Pula automaticamente sem KICK_STAGING_ACCESS_TOKEN no ambiente.
 * Ver backend/TESTING.md para instruções de setup (OAuth Kick, APP_KEY).
 *
 * Canal alvo default: `xqc` (sempre alto volume). Para staging interno use
 * KICK_STAGING_CHANNEL=<slug>.
 *
 * O teste:
 *  1. Resolve chatroomId via KickRestClient.getChannel(slug).
 *  2. Instancia KickPusherProvider real (Pusher us2 público).
 *  3. Aguarda 1 RawMessage válida via Zod em ≤ 90s.
 *  4. healthz reporta alive + lastMessageAt recente.
 *  5. disconnect + reconnect sem leak (Pusher.disconnect limpa socket).
 */
import { KickPusherProvider } from '../../src/ingestion/kick-pusher/kick-pusher.provider';
import { KickRestClient } from '../../src/ingestion/kick-pusher/kick-rest.client';
import { RawMessageSchema } from '@sehloro/domain';
import type { RawMessage, LifecycleEvent } from '@sehloro/domain';

const STAGING_TOKEN = process.env.KICK_STAGING_ACCESS_TOKEN;
const CHANNEL_SLUG = process.env.KICK_STAGING_CHANNEL ?? 'xqc';
const TIMEOUT_MS = 100_000;
const MESSAGE_WAIT_MS = 90_000;

const describeIfToken = STAGING_TOKEN ? describe : describe.skip;

// Stub mínimo de Channel (espelha twitch-irc.integration.spec.ts).
function makeChannelStub(slug: string) {
  return {
    getName: () => slug,
    getExternalId: () => slug,
    getId: () => slug,
    getPlatform: () => 'kick' as const,
  };
}

// Stub de KickTokenService que devolve o staging token direto.
function makeTokenServiceStub(token: string) {
  return {
    getValidToken: async (_channelId: string) => token,
  };
}

describeIfToken('KickPusherProvider — integração real', () => {
  // KickEmoteDictionary é entregável de EMO-01/KCK-03 (Milestone M4) — passa
  // `undefined` no integration test (mapper aceita opcional).
  const dictionary = undefined;
  const restClient = new KickRestClient();
  let provider: KickPusherProvider;

  afterEach(async () => {
    await provider?.disconnect().catch(() => undefined);
  });

  it(
    'descobre chatroomId, conecta e recebe ≥1 RawMessage válida em 90s',
    async () => {
      // 1. Resolve chatroomId
      const channel = await restClient.getChannel(CHANNEL_SLUG);
      expect(channel).not.toBeNull();
      expect(channel!.chatroomId).toEqual(expect.any(Number));

      // 2. Instancia provider
      const channelStub = makeChannelStub(CHANNEL_SLUG);
      const tokenService = makeTokenServiceStub(STAGING_TOKEN!);

      provider = new KickPusherProvider(
        channelStub as never,
        { chatroomId: channel!.chatroomId },
        tokenService,
        dictionary,
        restClient,
      );

      const messages: RawMessage[] = [];
      const lifecycleEvents: LifecycleEvent[] = [];

      provider.onMessage((m) => messages.push(m));
      provider.onLifecycle((e) => lifecycleEvents.push(e));

      await provider.connect();

      // 3. Aguarda primeira mensagem
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout: nenhuma msg recebida em ${MESSAGE_WAIT_MS}ms`)),
          MESSAGE_WAIT_MS,
        );
        provider.onMessage(() => {
          clearTimeout(timer);
          resolve();
        });
      });

      expect(messages.length).toBeGreaterThan(0);

      // 4. Valida shape via Zod
      const first = messages[0];
      const parsed = RawMessageSchema.safeParse(first);
      expect(parsed.success).toBe(true);

      expect(first.platform).toBe('kick');
      expect(first.channelName).toBe(CHANNEL_SLUG);
      expect(typeof first.user.username).toBe('string');
      expect(typeof first.text).toBe('string');
      expect(first.receivedAt).toBeInstanceOf(Date);

      // 5. healthz com lastMessageAt recente
      const health = await provider.healthz();
      expect(health.alive).toBe(true);
      expect(health.lastMessageAt).toBeInstanceOf(Date);
      expect(Date.now() - health.lastMessageAt!.getTime()).toBeLessThan(MESSAGE_WAIT_MS);

      // Lifecycle 'connected' deve ter sido emitido
      expect(lifecycleEvents.some((e) => e.type === 'connected')).toBe(true);
    },
    TIMEOUT_MS,
  );

  it('healthz antes de connect retorna alive:false', async () => {
    const channel = await restClient.getChannel(CHANNEL_SLUG);
    const channelStub = makeChannelStub(CHANNEL_SLUG);
    const tokenService = makeTokenServiceStub(STAGING_TOKEN!);

    provider = new KickPusherProvider(
      channelStub as never,
      { chatroomId: channel!.chatroomId },
      tokenService,
      dictionary,
    );

    const health = await provider.healthz();
    expect(health.alive).toBe(false);
  }, 15_000);

  it(
    'disconnect é idempotente (chamar 2x não lança)',
    async () => {
      const channel = await restClient.getChannel(CHANNEL_SLUG);
      const channelStub = makeChannelStub(CHANNEL_SLUG);
      const tokenService = makeTokenServiceStub(STAGING_TOKEN!);

      provider = new KickPusherProvider(
        channelStub as never,
        { chatroomId: channel!.chatroomId },
        tokenService,
        dictionary,
      );

      await provider.connect();
      await provider.disconnect();
      await expect(provider.disconnect()).resolves.not.toThrow();

      const health = await provider.healthz();
      expect(health.alive).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    'reconecta após disconnect sem vazar handlers',
    async () => {
      const channel = await restClient.getChannel(CHANNEL_SLUG);
      const channelStub = makeChannelStub(CHANNEL_SLUG);
      const tokenService = makeTokenServiceStub(STAGING_TOKEN!);

      provider = new KickPusherProvider(
        channelStub as never,
        { chatroomId: channel!.chatroomId },
        tokenService,
        dictionary,
      );

      await provider.connect();
      await provider.disconnect();

      // Reconnect — Pusher cria novo socket internamente.
      await provider.connect();
      const health = await provider.healthz();
      // alive depende do handshake — aguarda até 5s.
      const deadline = Date.now() + 5_000;
      let final = health;
      while (!final.alive && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        final = await provider.healthz();
      }
      expect(final.alive).toBe(true);
    },
    TIMEOUT_MS,
  );
});
