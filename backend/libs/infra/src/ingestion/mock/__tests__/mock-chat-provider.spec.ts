/**
 * Testes do MockChatProvider (CHAT-04) — cobertura 100%.
 */
import path from 'node:path';
import { RawMessage } from '@sehloro/domain';
import { MockChatProvider } from '../mock-chat-provider';

const FIXTURES = path.join(__dirname, '../../../../test-fixtures/chat');

function makeMsgs(count: number, baseMs = 0): RawMessage[] {
  return Array.from({ length: count }, (_, i) =>
    MockChatProvider.makeMessage({
      id: `msg-${i}`,
      receivedAt: new Date(baseMs + i * 1000),
    }),
  );
}

describe('MockChatProvider', () => {
  describe('fromArray + scale=0 (dump instantâneo)', () => {
    it('connect emite todas as mensagens imediatamente', async () => {
      const msgs = makeMsgs(3);
      const provider = MockChatProvider.fromArray(msgs, { scale: 0 });
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));

      await provider.connect();

      expect(received).toHaveLength(3);
      expect(received.map((m) => m.id)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    });

    it('mensagens emitidas na ordem de receivedAt independente da ordem do array', async () => {
      // Mesmo passando o array invertido, o provider ordena por receivedAt
      const msgs = makeMsgs(3, 0).reverse(); // [msg-2, msg-1, msg-0] em memória
      const provider = MockChatProvider.fromArray(msgs, { scale: 0 });
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));
      await provider.connect();
      // Ordenados por receivedAt → msg-0 (0ms), msg-1 (1000ms), msg-2 (2000ms)
      expect(received.map((m) => m.id)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    });

    it('connect com array vazio não emite mensagens', async () => {
      const provider = MockChatProvider.fromArray([], { scale: 0 });
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));
      await provider.connect();
      expect(received).toHaveLength(0);
    });

    it('connect idempotente — segunda chamada não re-emite', async () => {
      const msgs = makeMsgs(2);
      const provider = MockChatProvider.fromArray(msgs, { scale: 0 });
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));
      await provider.connect();
      await provider.connect(); // segunda chamada
      expect(received).toHaveLength(2); // não duplicou
    });
  });

  describe('scale > 0 (replay com tempo)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('scale=10 agenda mensagens com delay / 10', async () => {
      // 3 msgs com 1000ms de diferença entre si
      const msgs = makeMsgs(3, Date.now());
      const provider = MockChatProvider.fromArray(msgs, { scale: 10 });
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));

      await provider.connect();
      expect(received).toHaveLength(1); // msg-0 tem delay 0 → emitida imediatamente
      jest.advanceTimersByTime(100); // 1000/10 = 100ms
      expect(received).toHaveLength(2);
      jest.advanceTimersByTime(100);
      expect(received).toHaveLength(3);
    });

    it('disconnect cancela timers pendentes', async () => {
      const msgs = makeMsgs(3, Date.now());
      const provider = MockChatProvider.fromArray(msgs, { scale: 10 });
      const received: RawMessage[] = [];
      provider.onMessage((m) => received.push(m));

      await provider.connect();
      await provider.disconnect();
      jest.advanceTimersByTime(1000); // avança tempo, mas timers cancelados
      expect(received).toHaveLength(1); // só a msg-0 (delay 0)
    });
  });

  describe('fromFile', () => {
    it('carrega fixture twitch-sample-valorant.json', () => {
      const provider = MockChatProvider.fromFile(
        path.join(FIXTURES, 'twitch-sample-valorant.json'),
      );
      expect(provider.messages.length).toBe(200);
      expect(provider.fixtureViewerCount).toBe(12500);
      expect(provider.messages[0].receivedAt).toBeInstanceOf(Date);
    });

    it('carrega fixture kick-sample-xqc.json com platform kick', () => {
      const provider = MockChatProvider.fromFile(path.join(FIXTURES, 'kick-sample-xqc.json'));
      expect(provider.messages[0].platform).toBe('kick');
      expect(provider.fixtureViewerCount).toBe(45000);
    });

    it('carrega fixture copypasta-burst.json', () => {
      const provider = MockChatProvider.fromFile(path.join(FIXTURES, 'copypasta-burst.json'));
      expect(provider.messages.length).toBe(50);
    });

    it('carrega fixture brazilian-hype.json', () => {
      const provider = MockChatProvider.fromFile(path.join(FIXTURES, 'brazilian-hype.json'));
      expect(provider.messages.length).toBe(100);
    });

    it('viewerCount do options prevalece sobre viewerCount do arquivo', () => {
      const provider = MockChatProvider.fromFile(
        path.join(FIXTURES, 'twitch-sample-valorant.json'),
        {},
        { viewerCount: 999 },
      );
      expect(provider.fixtureViewerCount).toBe(999);
    });
  });

  describe('getViewerCount', () => {
    it('retorna viewerCount das options', async () => {
      const provider = MockChatProvider.fromArray(makeMsgs(1), { viewerCount: 777 });
      expect(await provider.getViewerCount()).toBe(777);
    });

    it('retorna null quando não configurado', async () => {
      const provider = MockChatProvider.fromArray([]);
      expect(await provider.getViewerCount()).toBeNull();
    });
  });

  describe('healthz', () => {
    it('retorna alive:false antes de connect', async () => {
      const provider = MockChatProvider.fromArray(makeMsgs(1));
      const h = await provider.healthz();
      expect(h.alive).toBe(false);
      expect(h.lastMessageAt).toBeUndefined();
    });

    it('retorna alive:true após connect', async () => {
      const provider = MockChatProvider.fromArray(makeMsgs(1), { scale: 0 });
      await provider.connect();
      const h = await provider.healthz();
      expect(h.alive).toBe(true);
      expect(h.lastMessageAt).toBeInstanceOf(Date);
    });

    it('retorna alive:false após disconnect', async () => {
      const provider = MockChatProvider.fromArray(makeMsgs(1), { scale: 0 });
      await provider.connect();
      await provider.disconnect();
      expect((await provider.healthz()).alive).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('é idempotente — chamar 2x não lança', async () => {
      const provider = MockChatProvider.fromArray(makeMsgs(1), { scale: 0 });
      await provider.connect();
      await expect(provider.disconnect()).resolves.not.toThrow();
      await expect(provider.disconnect()).resolves.not.toThrow();
    });

    it('disconnect sem connect não lança', async () => {
      const provider = MockChatProvider.fromArray([]);
      await expect(provider.disconnect()).resolves.not.toThrow();
    });
  });

  describe('onMessage / onLifecycle — unsubscribe', () => {
    it('unsubscribe remove handler de mensagens', async () => {
      const msgs = makeMsgs(3);
      const provider = MockChatProvider.fromArray(msgs, { scale: 0 });
      const received: string[] = [];

      const unsub = provider.onMessage((m) => received.push(m.id));
      unsub(); // remove antes de connect
      await provider.connect();

      expect(received).toHaveLength(0);
    });

    it('unsubscribe é idempotente', () => {
      const provider = MockChatProvider.fromArray([]);
      const unsub = provider.onMessage(() => {});
      expect(() => {
        unsub();
        unsub();
      }).not.toThrow();
    });

    it('múltiplos handlers recebem a mesma mensagem', async () => {
      const msgs = makeMsgs(1);
      const provider = MockChatProvider.fromArray(msgs, { scale: 0 });
      const a: string[] = [];
      const b: string[] = [];
      provider.onMessage((m) => a.push(m.id));
      provider.onMessage((m) => b.push(m.id));
      await provider.connect();
      expect(a).toEqual(['msg-0']);
      expect(b).toEqual(['msg-0']);
    });

    it('emit helper aciona handlers registrados', () => {
      const provider = MockChatProvider.fromArray([]);
      const received: string[] = [];
      provider.onMessage((m) => received.push(m.id));
      const msg = MockChatProvider.makeMessage({ id: 'direct' });
      provider.emit(msg);
      expect(received).toEqual(['direct']);
    });

    it('onLifecycle recebe connected e disconnected', async () => {
      const provider = MockChatProvider.fromArray([], { scale: 0 });
      const events: string[] = [];
      provider.onLifecycle((e) => events.push(e.type));
      await provider.connect();
      await provider.disconnect();
      expect(events).toEqual(['connected', 'disconnected']);
    });

    it('unsubscribe lifecycle remove handler', async () => {
      const provider = MockChatProvider.fromArray([]);
      const events: string[] = [];
      const unsub = provider.onLifecycle((e) => events.push(e.type));
      unsub();
      await provider.connect();
      expect(events).toHaveLength(0);
    });

    it('emitLifecycle helper aciona handlers', () => {
      const provider = MockChatProvider.fromArray([]);
      const events: string[] = [];
      provider.onLifecycle((e) => events.push(e.type));
      provider.emitLifecycle({ type: 'reconnecting', ts: new Date() });
      expect(events).toEqual(['reconnecting']);
    });
  });

  describe('makeMessage', () => {
    it('retorna RawMessage válida com defaults', () => {
      const msg = MockChatProvider.makeMessage();
      expect(msg.id).toBeTruthy();
      expect(msg.platform).toBe('twitch');
      expect(msg.emotes).toEqual([]);
    });

    it('overrides são aplicados', () => {
      const msg = MockChatProvider.makeMessage({ text: 'custom', platform: 'kick' });
      expect(msg.text).toBe('custom');
      expect(msg.platform).toBe('kick');
    });
  });
});
