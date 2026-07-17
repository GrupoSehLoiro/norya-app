import { EventEmitter } from 'node:events';
import {
  HEARTBEAT_TIMEOUT_MS,
  TwitchEventSubNotification,
  TwitchEventSubRevocation,
  TwitchEventSubWsClient,
  TwitchEventSubWsHandlers,
  WsLike,
} from '../twitch-eventsub-ws.client';

/**
 * WebSocket fake: emite eventos via EventEmitter e expõe métodos `emitOpen` etc.
 * para os testes empurrarem frames manualmente.
 */
class FakeWs extends EventEmitter implements WsLike {
  public readyState = 0;
  public closed = false;
  public closeCode?: number;
  public closeReason?: string;

  emitMessage(frame: object): void {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }

  emitOpen(): void {
    this.readyState = 1;
    this.emit('open');
  }

  close(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close', code, Buffer.from(reason ?? ''));
  }
}

function welcomeFrame(sessionId: string): object {
  return {
    metadata: { message_id: 'm1', message_type: 'session_welcome', message_timestamp: 'now' },
    payload: { session: { id: sessionId, keepalive_timeout_seconds: 10 } },
  };
}

function keepaliveFrame(): object {
  return {
    metadata: { message_id: 'k1', message_type: 'session_keepalive', message_timestamp: 'now' },
    payload: {},
  };
}

function notificationFrame(type: string, event: Record<string, unknown>): object {
  return {
    metadata: {
      message_id: 'n1',
      message_type: 'notification',
      message_timestamp: 'now',
      subscription_type: type,
      subscription_version: '1',
    },
    payload: {
      subscription: { id: 'sub-1', type, version: '1', status: 'enabled', condition: {} },
      event,
    },
  };
}

function reconnectFrame(reconnectUrl: string): object {
  return {
    metadata: { message_id: 'r1', message_type: 'session_reconnect', message_timestamp: 'now' },
    payload: { session: { id: 'old-sess', reconnect_url: reconnectUrl } },
  };
}

function revocationFrame(): object {
  return {
    metadata: { message_id: 'rev1', message_type: 'revocation', message_timestamp: 'now' },
    payload: {
      subscription: { id: 'sub-1', type: 'channel.chat.message', status: 'authorization_revoked' },
    },
  };
}

describe('TwitchEventSubWsClient', () => {
  let onWelcome: jest.Mock;
  let onNotification: jest.Mock<void, [TwitchEventSubNotification]>;
  let onRevocation: jest.Mock<void, [TwitchEventSubRevocation]>;
  let onKeepalive: jest.Mock;
  let handlers: TwitchEventSubWsHandlers;
  let createdSockets: FakeWs[];

  beforeEach(() => {
    jest.useFakeTimers();
    onWelcome = jest.fn().mockResolvedValue(undefined);
    onNotification = jest.fn();
    onRevocation = jest.fn();
    onKeepalive = jest.fn();
    handlers = { onWelcome, onNotification, onRevocation, onKeepalive };
    createdSockets = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeClient(opts: { url?: string } = {}): {
    client: TwitchEventSubWsClient;
    nextSocket: () => FakeWs;
    factory: jest.Mock;
  } {
    const factory = jest.fn().mockImplementation(() => {
      const ws = new FakeWs();
      createdSockets.push(ws);
      return ws;
    });
    const client = new TwitchEventSubWsClient(handlers, factory, opts);
    return { client, nextSocket: () => createdSockets[createdSockets.length - 1]!, factory };
  }

  it('chama onWelcome com o session_id e expõe currentSessionId', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-abc'));
    await Promise.resolve();

    expect(onWelcome).toHaveBeenCalledWith('sess-abc');
    expect(client.currentSessionId).toBe('sess-abc');
    client.close();
  });

  it('encaminha notification para onNotification', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-1'));
    await Promise.resolve();

    nextSocket().emitMessage(
      notificationFrame('channel.chat.message', { message: { text: 'hi' } }),
    );

    expect(onNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({ type: 'channel.chat.message' }),
        event: expect.objectContaining({ message: { text: 'hi' } }),
      }),
    );
    client.close();
  });

  it('encaminha revocation para onRevocation', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-1'));
    await Promise.resolve();
    nextSocket().emitMessage(revocationFrame());

    expect(onRevocation).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({ status: 'authorization_revoked' }),
      }),
    );
    client.close();
  });

  it('keepalive dispara onKeepalive e reseta o heartbeat', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-1'));
    await Promise.resolve();

    // Avança 14s — keepalive segura o heartbeat aberto.
    jest.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1_000);
    nextSocket().emitMessage(keepaliveFrame());
    expect(onKeepalive).toHaveBeenCalled();

    // Avança mais 14s — ainda dentro do timeout porque o keepalive resetou.
    jest.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1_000);
    expect(nextSocket().closed).toBe(false);

    client.close();
  });

  it('fecha o socket quando passa heartbeatTimeout sem frames', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-1'));
    await Promise.resolve();

    jest.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS + 100);

    expect(nextSocket().closed).toBe(true);
    expect(nextSocket().closeCode).toBe(4000);

    client.close();
  });

  it('session_reconnect troca de URL e abre nova conexão', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-old'));
    await Promise.resolve();

    nextSocket().emitMessage(reconnectFrame('wss://eventsub.wss.twitch.tv/ws?reconnect=token'));

    // Socket novo foi criado; o anterior foi fechado.
    expect(createdSockets).toHaveLength(2);
    expect(createdSockets[0]!.closed).toBe(true);
    expect(createdSockets[0]!.closeReason).toBe('session_reconnect');

    client.close();
  });

  it('close do socket antigo pós-session_reconnect NÃO agenda reconexão extra', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-old'));
    await Promise.resolve();

    nextSocket().emitMessage(reconnectFrame('wss://eventsub.wss.twitch.tv/ws?reconnect=token'));
    expect(createdSockets).toHaveLength(2);

    // Regressão do loop 4007: o close do socket ANTIGO (handoff) agendava um
    // reconnect (~500ms de backoff) na reconnect_url já consumida. Avança além
    // do backoff mas AQUÉM do heartbeat (15s, que legitimamente reconecta se o
    // welcome não vier) — nenhuma conexão extra pode surgir nessa janela.
    jest.advanceTimersByTime(10_000);
    expect(createdSockets).toHaveLength(2);

    client.close();
  });

  it('queda após session_reconnect volta para a URL base (reconnect_url é single-use)', async () => {
    const { client, nextSocket, factory } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-old'));
    await Promise.resolve();

    nextSocket().emitMessage(reconnectFrame('wss://eventsub.wss.twitch.tv/ws?reconnect=token'));
    const handoffSocket = nextSocket();
    expect(factory).toHaveBeenLastCalledWith('wss://eventsub.wss.twitch.tv/ws?reconnect=token');

    // A conexão do handoff cai (ex.: 4007 invalid reconnect attempt).
    handoffSocket.close(4007, 'invalid reconnect attempt');
    jest.advanceTimersByTime(120_000);

    // O retry deve ir para a URL default, nunca repetir a reconnect_url.
    expect(createdSockets.length).toBeGreaterThanOrEqual(3);
    expect(factory).toHaveBeenLastCalledWith('wss://eventsub.wss.twitch.tv/ws');

    client.close();
  });

  it('reconecta com backoff após close inesperado', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();
    nextSocket().emitMessage(welcomeFrame('sess-1'));
    await Promise.resolve();

    // Simula queda — close sem o cliente ter pedido.
    nextSocket().close(1006, 'unexpected');

    // Antes do delay expirar, ainda não houve novo socket.
    expect(createdSockets).toHaveLength(1);

    // 500ms (BACKOFF_BASE_MS) é o piso; jitter pode adicionar até 30%.
    jest.advanceTimersByTime(1_000);
    expect(createdSockets.length).toBeGreaterThanOrEqual(2);

    client.close();
  });

  it('close() impede reconexões subsequentes', async () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();

    client.close();
    nextSocket().close(1006, 'after close');
    jest.advanceTimersByTime(5_000);

    expect(createdSockets).toHaveLength(1);
  });

  it('frame inválido (não-JSON) é descartado sem derrubar o cliente', () => {
    const { client, nextSocket } = makeClient();
    client.connect();
    nextSocket().emitOpen();

    nextSocket().emit('message', Buffer.from('not-json{'));

    expect(onWelcome).not.toHaveBeenCalled();
    client.close();
  });
});
