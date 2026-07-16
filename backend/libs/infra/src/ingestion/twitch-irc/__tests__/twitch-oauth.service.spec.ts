/**
 * Unit do TwitchOAuthService.
 *
 * Foco: state HMAC + verifyState + storeToken (mockado repo + crypto).
 * `exchangeCode` e `getValidToken` chamam Twitch real → não cobrimos aqui;
 * ficam no e2e do controller.
 */
import { UnauthorizedException } from '@nestjs/common';
import { TwitchOAuthService, type TwitchTokenResponse } from '../twitch-oauth.service';
import type { ChannelOAuthToken } from '@sehloro/domain';

const JWT_SECRET = 'a'.repeat(40);

function mockCrypto() {
  return {
    encryptField: (s: string | null | undefined) => (s == null ? s : `enc(${s})`),
    decryptField: (s: string | null | undefined) =>
      s == null ? s : String(s).replace(/^enc\(|\)$/g, ''),
  };
}

function mockConfig(overrides: Record<string, string | undefined> = {}) {
  const map: Record<string, string | undefined> = {
    JWT_SECRET,
    TWITCH_CLIENT_ID: 'cid',
    TWITCH_CLIENT_SECRET: 'csec',
    ...overrides,
  };
  return {
    get: (key: string) => map[key],
  };
}

function mockTokenRepo() {
  const saved: ChannelOAuthToken[] = [];
  return {
    saved,
    save: (token: ChannelOAuthToken) => {
      saved.push(token);
      return Promise.resolve(token);
    },
    findByChannelId: () => Promise.resolve(null),
    delete: () => Promise.resolve(),
  };
}

function makeService(opts: { config?: unknown; repo?: unknown; crypto?: unknown } = {}) {
  return new TwitchOAuthService(
    (opts.repo ?? mockTokenRepo()) as never,
    (opts.crypto ?? mockCrypto()) as never,
    (opts.config ?? mockConfig()) as never,
  );
}

describe('TwitchOAuthService — state HMAC', () => {
  it('generateState → verifyState devolve userId + redirect', () => {
    const svc = makeService();
    const state = svc.generateState('user-1', '/insights/abc');
    const out = svc.verifyState(state);
    expect(out.userId).toBe('user-1');
    expect(out.redirect).toBe('/insights/abc');
  });

  it('redirect default = null quando não passado', () => {
    const svc = makeService();
    const state = svc.generateState('user-2');
    expect(svc.verifyState(state).redirect).toBeNull();
  });

  it('workspaceId viaja no state e volta no verifyState', () => {
    const svc = makeService();
    const state = svc.generateState('user-1', undefined, 'ws-9');
    expect(svc.verifyState(state).workspaceId).toBe('ws-9');
  });

  it('workspaceId default = null quando não passado', () => {
    const svc = makeService();
    const state = svc.generateState('user-2');
    expect(svc.verifyState(state).workspaceId).toBeNull();
  });

  it('payload adulterado → UnauthorizedException', () => {
    const svc = makeService();
    const original = svc.generateState('user-1');
    // Adultera o payload mantendo a assinatura → mismatch
    const [, sig] = original.split('.');
    const tampered =
      Buffer.from(
        JSON.stringify({
          userId: 'attacker',
          nonce: 'x',
          exp: Date.now() + 60_000,
          redirect: null,
        }),
      ).toString('base64url') +
      '.' +
      sig;
    expect(() => svc.verifyState(tampered)).toThrow(UnauthorizedException);
  });

  it('state sem ponto separador → invalido', () => {
    const svc = makeService();
    expect(() => svc.verifyState('semponto')).toThrow(UnauthorizedException);
  });

  it('state com payload mal-formado (não JSON) → invalido', () => {
    const svc = makeService();
    // Geramos uma assinatura válida pra "naojson" pra passar o checksum
    // e cair no JSON.parse interno
    const payload = Buffer.from('naojson').toString('base64url');
    const sig = (svc as unknown as { _sign(p: string): string })._sign(payload);
    expect(() => svc.verifyState(`${payload}.${sig}`)).toThrow(UnauthorizedException);
  });

  it('state expirado → UnauthorizedException', () => {
    const svc = makeService();
    const payload = Buffer.from(
      JSON.stringify({
        userId: 'u',
        nonce: 'x',
        exp: Date.now() - 1,
        redirect: null,
      }),
    ).toString('base64url');
    const sig = (svc as unknown as { _sign(p: string): string })._sign(payload);
    expect(() => svc.verifyState(`${payload}.${sig}`)).toThrow(UnauthorizedException);
  });

  it('JWT_SECRET diferente invalida o state — não vaza HMAC', () => {
    const a = makeService({ config: mockConfig({ JWT_SECRET: 'a'.repeat(40) }) });
    const b = makeService({ config: mockConfig({ JWT_SECRET: 'b'.repeat(40) }) });
    const stateA = a.generateState('user-1');
    expect(() => b.verifyState(stateA)).toThrow(UnauthorizedException);
  });
});

describe('TwitchOAuthService — storeToken', () => {
  it('cifra access + refresh antes de persistir', async () => {
    const repo = mockTokenRepo();
    const crypto = mockCrypto();
    const svc = makeService({ repo, crypto });
    const token: TwitchTokenResponse = {
      access_token: 'plain-access',
      refresh_token: 'plain-refresh',
      expires_in: 3600,
      token_type: 'bearer',
      scope: ['user:read:email', 'user:read:chat'],
    };
    await svc.storeToken({ channelId: 'channel-id-1', token });
    expect(repo.saved.length).toBe(1);
    const entity = repo.saved[0];
    expect(entity.getAccessToken()).toBe('enc(plain-access)');
    expect(entity.getRefreshToken()).toBe('enc(plain-refresh)');
    expect(entity.getScope()).toBe('user:read:email user:read:chat');
    // expiresAt no futuro próximo
    const dt = entity.getExpiresAt().getTime();
    expect(dt).toBeGreaterThan(Date.now() + 3_000_000);
    expect(dt).toBeLessThan(Date.now() + 4_000_000);
  });

  it('aceita scope como string (Twitch às vezes manda assim)', async () => {
    const repo = mockTokenRepo();
    const svc = makeService({ repo });
    const token: TwitchTokenResponse = {
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 10,
      token_type: 'bearer',
      scope: 'chat:read channel:bot' as unknown as string[],
    };
    await svc.storeToken({ channelId: 'c1', token });
    expect(repo.saved[0].getScope()).toBe('chat:read channel:bot');
  });
});
