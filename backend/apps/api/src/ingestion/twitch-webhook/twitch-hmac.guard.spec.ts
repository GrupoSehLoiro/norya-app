import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { InMemoryNonceStore } from './nonce-store';
import { TwitchHmacGuard } from './twitch-hmac.guard';

const SECRET = 'webhook-secret-very-long-string';

function buildSignature(
  messageId: string,
  timestamp: string,
  body: Buffer,
  secret = SECRET,
): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(Buffer.concat([Buffer.from(messageId), Buffer.from(timestamp), body]));
  return `sha256=${hmac.digest('hex')}`;
}

function makeCtx(input: {
  body: Buffer;
  headers: Record<string, string | undefined>;
}): ExecutionContext {
  const req = {
    headers: input.headers,
    rawBody: input.body,
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('TwitchHmacGuard', () => {
  let config: ConfigService;
  let nonceStore: InMemoryNonceStore;
  let guard: TwitchHmacGuard;

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(SECRET) } as unknown as ConfigService;
    nonceStore = new InMemoryNonceStore();
    guard = new TwitchHmacGuard(config, nonceStore);
  });

  it('passa quando assinatura, timestamp e nonce são válidos', async () => {
    const body = Buffer.from(JSON.stringify({ subscription: { id: 's', type: 'stream.online' } }));
    const timestamp = new Date().toISOString();
    const messageId = 'm-1';
    const ctx = makeCtx({
      body,
      headers: {
        'twitch-eventsub-message-id': messageId,
        'twitch-eventsub-message-signature': buildSignature(messageId, timestamp, body),
        'twitch-eventsub-message-timestamp': timestamp,
      },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejeita com 403 quando a assinatura não bate', async () => {
    const body = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const ctx = makeCtx({
      body,
      headers: {
        'twitch-eventsub-message-id': 'm-2',
        'twitch-eventsub-message-signature': 'sha256=' + 'a'.repeat(64),
        'twitch-eventsub-message-timestamp': timestamp,
      },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejeita assinatura sem prefixo sha256=', async () => {
    const body = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const ctx = makeCtx({
      body,
      headers: {
        'twitch-eventsub-message-id': 'm-3',
        'twitch-eventsub-message-signature': 'a'.repeat(64),
        'twitch-eventsub-message-timestamp': timestamp,
      },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejeita com 403 quando o timestamp tem mais de 10 minutos de skew', async () => {
    const body = Buffer.from('{}');
    const oldTimestamp = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const messageId = 'm-4';
    const ctx = makeCtx({
      body,
      headers: {
        'twitch-eventsub-message-id': messageId,
        'twitch-eventsub-message-signature': buildSignature(messageId, oldTimestamp, body),
        'twitch-eventsub-message-timestamp': oldTimestamp,
      },
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejeita com 409 quando o message_id se repete dentro da janela', async () => {
    const body = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const messageId = 'duplicate-id';
    const ctx = makeCtx({
      body,
      headers: {
        'twitch-eventsub-message-id': messageId,
        'twitch-eventsub-message-signature': buildSignature(messageId, timestamp, body),
        'twitch-eventsub-message-timestamp': timestamp,
      },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    // segunda vez: nonce já visto
    const ctx2 = makeCtx({
      body,
      headers: {
        'twitch-eventsub-message-id': messageId,
        'twitch-eventsub-message-signature': buildSignature(messageId, timestamp, body),
        'twitch-eventsub-message-timestamp': timestamp,
      },
    });
    await expect(guard.canActivate(ctx2)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita com 400 quando o body cru não está presente', async () => {
    const ctx = makeCtx({
      body: undefined as unknown as Buffer,
      headers: {
        'twitch-eventsub-message-id': 'm-5',
        'twitch-eventsub-message-signature': 'sha256=' + 'a'.repeat(64),
        'twitch-eventsub-message-timestamp': new Date().toISOString(),
      },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita com 400 quando algum header obrigatório está ausente', async () => {
    const ctx = makeCtx({
      body: Buffer.from('{}'),
      headers: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita com 400 quando TWITCH_WEBHOOK_SECRET não está configurado', async () => {
    config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    guard = new TwitchHmacGuard(config, nonceStore);

    const ctx = makeCtx({
      body: Buffer.from('{}'),
      headers: {
        'twitch-eventsub-message-id': 'x',
        'twitch-eventsub-message-signature': 'sha256=xx',
        'twitch-eventsub-message-timestamp': new Date().toISOString(),
      },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(BadRequestException);
  });
});
