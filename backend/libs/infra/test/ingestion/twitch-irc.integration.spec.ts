/**
 * TWI-05 · TwitchIrcProvider — teste de integração contra canal real.
 *
 * Pula automaticamente sem TWITCH_STAGING_TOKEN no ambiente.
 * Ver backend/TESTING.md para instruções de setup.
 *
 * Canal alvo: rogerbatt (canal brasileiro de FPS — alto volume de chat,
 * emotes em português, boa cobertura dos campos RawMessage).
 */
import { TwitchIrcProvider } from '../../src/ingestion/twitch-irc/twitch-irc.provider';
import { TwitchEmoteDictionary } from '@sehloro/domain';
import type { RawMessage, LifecycleEvent } from '@sehloro/domain';
import { RawMessageSchema } from '@sehloro/domain';

const STAGING_TOKEN = process.env.TWITCH_STAGING_TOKEN;
const CHANNEL_NAME = process.env.TWITCH_STAGING_CHANNEL ?? 'rogerbatt';
const TIMEOUT_MS = 120_000;

const describeIfToken = STAGING_TOKEN ? describe : describe.skip;

// Stub mínimo de CryptoService — devolve o campo sem decriptar pois o token
// já é plaintext no staging env.
const cryptoStub = {
  decryptField: (v: string) => v,
  encryptField: (v: string) => v,
};

// Stub de ChannelOAuthToken com o access token de staging.
function makeTokenStub(token: string) {
  return {
    getAccessToken: () => token,
    getRefreshToken: () => '',
    getExpiresAt: () => new Date(Date.now() + 3_600_000),
    getChannelId: () => 'staging',
    getPlatform: () => 'twitch' as const,
    getId: () => 'staging-token',
    getScope: () => 'chat:read',
    getUpdatedAt: () => new Date(),
    isExpired: () => false,
    isInvalidated: () => false,
    getInvalidatedAt: () => undefined,
  };
}

// Stub de Channel.
function makeChannelStub(name: string) {
  return {
    getName: () => name,
    getExternalId: () => name,
    getId: () => name,
    getPlatform: () => 'twitch' as const,
  };
}

describeIfToken('TwitchIrcProvider — integração real', () => {
  const dictionary = new TwitchEmoteDictionary();
  let provider: TwitchIrcProvider;

  afterEach(async () => {
    await provider?.disconnect().catch(() => undefined);
  });

  it(
    'conecta ao canal e recebe ao menos 1 RawMessage válida em 120s',
    async () => {
      const tokenStub = makeTokenStub(STAGING_TOKEN!);
      const channelStub = makeChannelStub(CHANNEL_NAME);

      provider = new TwitchIrcProvider(
        tokenStub as never,
        channelStub as never,
        cryptoStub as never,
        undefined,
        dictionary,
      );

      const messages: RawMessage[] = [];
      const lifecycleEvents: LifecycleEvent[] = [];

      provider.onMessage((msg) => messages.push(msg));
      provider.onLifecycle((evt) => lifecycleEvents.push(evt));

      await provider.connect();

      // Aguarda primeira mensagem ou timeout.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout: nenhuma mensagem recebida em 120s')),
          TIMEOUT_MS - 5_000,
        );
        provider.onMessage(() => {
          clearTimeout(timer);
          resolve();
        });
      });

      expect(messages.length).toBeGreaterThan(0);

      // Valida shape via Zod.
      const first = messages[0];
      const parsed = RawMessageSchema.safeParse(first);
      expect(parsed.success).toBe(true);

      // Campos obrigatórios.
      expect(first.platform).toBe('twitch');
      expect(first.channelName).toBe(CHANNEL_NAME);
      expect(typeof first.user.username).toBe('string');
      expect(typeof first.text).toBe('string');
      expect(first.receivedAt).toBeInstanceOf(Date);

      // healthz deve reportar alive após mensagens chegarem.
      const health = await provider.healthz();
      expect(health.alive).toBe(true);
      expect(health.lastMessageAt).toBeInstanceOf(Date);

      // Lifecycle deve ter recebido 'connected'.
      expect(lifecycleEvents.some((e) => e.type === 'connected')).toBe(true);
    },
    TIMEOUT_MS,
  );

  it('healthz antes de connect retorna alive:false', async () => {
    const tokenStub = makeTokenStub(STAGING_TOKEN!);
    const channelStub = makeChannelStub(CHANNEL_NAME);

    provider = new TwitchIrcProvider(tokenStub as never, channelStub as never, cryptoStub as never);

    const health = await provider.healthz();
    expect(health.alive).toBe(false);
  }, 10_000);

  it(
    'disconnect + reconnect sem vazamento de handler',
    async () => {
      const tokenStub = makeTokenStub(STAGING_TOKEN!);
      const channelStub = makeChannelStub(CHANNEL_NAME);

      provider = new TwitchIrcProvider(
        tokenStub as never,
        channelStub as never,
        cryptoStub as never,
      );

      await provider.connect();
      await provider.disconnect();

      const health = await provider.healthz();
      expect(health.alive).toBe(false);

      // Reconecta sem erro.
      await provider.connect();
      const health2 = await provider.healthz();
      expect(health2.alive).toBe(true);
    },
    TIMEOUT_MS,
  );
});
