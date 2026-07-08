/**
 * CHAT-05 · Contract suite para ChatProvider.
 *
 * Garante que qualquer implementação de ChatProvider satisfaz as invariantes
 * do contrato. Exportar `runChatProviderContract(getProvider)` permite rodar
 * a mesma suíte contra TwitchIrc, KickPusher e TwitchConduit nos milestones
 * seguintes sem duplicar testes.
 *
 * No M2 a suíte roda apenas contra MockChatProvider.
 */
import { ChatProvider, RawMessage } from '@sehloro/domain';
import { RawMessageSchema } from '@sehloro/domain';
import { MockChatProvider } from '../src/ingestion/mock/mock-chat-provider';

/** Fábrica que deve retornar uma instância fresca e isolada para cada teste. */
export type ChatProviderFactory = () => ChatProvider | Promise<ChatProvider>;

/**
 * Executa o contrato completo contra qualquer implementação de ChatProvider.
 *
 * @param label  Nome exibido no describe (ex: 'MockChatProvider', 'TwitchIrcProvider')
 * @param getProvider  Fábrica chamada antes de cada teste — deve retornar instância limpa
 * @param afterEachHook  Cleanup opcional (ex: disconnect, fechar sockets)
 */
export function runChatProviderContract(
  label: string,
  getProvider: ChatProviderFactory,
  afterEachHook?: (provider: ChatProvider) => Promise<void>,
): void {
  describe(`ChatProvider contract — ${label}`, () => {
    let provider: ChatProvider;

    beforeEach(async () => {
      provider = await Promise.resolve(getProvider());
    });

    afterEach(async () => {
      if (afterEachHook) await afterEachHook(provider);
    });

    it('(1) connect() → onMessage recebe pelo menos 1 RawMessage válido pelo Zod schema', async () => {
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));
      await provider.connect();

      expect(received.length).toBeGreaterThanOrEqual(1);

      for (const msg of received) {
        const result = RawMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      }
    });

    it('(2) unsubscribe retornado por onMessage impede chamadas futuras', async () => {
      const received: RawMessage[] = [];
      const unsub = provider.onMessage((m) => received.push(m));
      unsub();

      await provider.connect();

      expect(received).toHaveLength(0);
    });

    it('(3) disconnect() é idempotente — chamar 2x não lança', async () => {
      await provider.connect();
      await expect(provider.disconnect()).resolves.not.toThrow();
      await expect(provider.disconnect()).resolves.not.toThrow();
    });

    it('(4) healthz() antes de connect retorna alive:false', async () => {
      const h = await provider.healthz();
      expect(h.alive).toBe(false);
    });

    it('(5) getViewerCount() nunca lança — retorna number ou null', async () => {
      let result: number | null | undefined;
      await expect(
        provider.getViewerCount().then((v) => {
          result = v;
        }),
      ).resolves.not.toThrow();
      expect(result === null || typeof result === 'number').toBe(true);
    });
  });
}

// ─── execução no M2: MockChatProvider ───────────────────────────────────────

runChatProviderContract(
  'MockChatProvider',
  () => {
    const msg = MockChatProvider.makeMessage();
    return MockChatProvider.fromArray([msg], { scale: 0 });
  },
  async (p) => {
    await p.disconnect();
  },
);
