/**
 * KCK-01 · KickOAuthService — testes unitários.
 * Mocka axios para não fazer chamadas reais à Kick API.
 */
import axios from 'axios';
import { KickOAuthService } from '../kick-oauth.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const JWT_SECRET = 'test-secret-at-least-32-chars-long!!';

function makeTokenRepo(existing: unknown = null) {
  return {
    findByChannelId: jest.fn().mockResolvedValue(existing),
    save: jest.fn().mockImplementation(async (t: unknown) => t),
    delete: jest.fn(),
  };
}

function makeCrypto() {
  return {
    encryptField: jest.fn((v: string) => `enc:${v}`),
    decryptField: jest.fn((v: string) => v.replace(/^enc:/, '')),
  };
}

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    JWT_SECRET,
    KICK_CLIENT_ID: 'kick-client-id',
    KICK_CLIENT_SECRET: 'kick-client-secret',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function makeService(repoOverride?: unknown) {
  return new KickOAuthService(
    (repoOverride ?? makeTokenRepo()) as never,
    makeCrypto() as never,
    makeConfig() as never,
  );
}

describe('KickOAuthService — state CSRF', () => {
  it('gera e verifica state válido', () => {
    const svc = makeService();
    const state = svc.generateState('user-1', '/integrations/kick');
    const result = svc.verifyState(state);
    expect(result.userId).toBe('user-1');
    expect(result.redirect).toBe('/integrations/kick');
    expect(result.workspaceId).toBeNull();
  });

  it('workspaceId viaja no state e volta no verifyState', () => {
    const svc = makeService();
    const state = svc.generateState('user-1', undefined, undefined, 'ws-9');
    expect(svc.verifyState(state).workspaceId).toBe('ws-9');
  });

  it('rejeita state adulterado', () => {
    const svc = makeService();
    const state = svc.generateState('user-1');
    const tampered = state.slice(0, -3) + 'xxx';
    expect(() => svc.verifyState(tampered)).toThrow('adulterado');
  });

  it('rejeita state sem ponto separador', () => {
    const svc = makeService();
    expect(() => svc.verifyState('invalido_sem_ponto')).toThrow('inválido');
  });

  it('rejeita state expirado', () => {
    jest.useFakeTimers();
    const svc = makeService();
    const state = svc.generateState('user-1');
    jest.advanceTimersByTime(11 * 60 * 1000); // avança 11 min
    expect(() => svc.verifyState(state)).toThrow('expirado');
    jest.useRealTimers();
  });

  it('state de serviços diferentes (secrets diferentes) é rejeitado', () => {
    const svc1 = new KickOAuthService(
      makeTokenRepo() as never,
      makeCrypto() as never,
      makeConfig({ JWT_SECRET: 'secret-A-at-least-32-chars-xxx' }) as never,
    );
    const svc2 = new KickOAuthService(
      makeTokenRepo() as never,
      makeCrypto() as never,
      makeConfig({ JWT_SECRET: 'secret-B-at-least-32-chars-yyy' }) as never,
    );
    const state = svc1.generateState('user-1');
    expect(() => svc2.verifyState(state)).toThrow('adulterado');
  });
});

describe('KickOAuthService — exchangeCode', () => {
  it('troca code por token e persiste encriptado', async () => {
    const repo = makeTokenRepo();
    const crypto = makeCrypto();
    const svc = new KickOAuthService(repo as never, crypto as never, makeConfig() as never);

    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: 'acc-123',
        refresh_token: 'ref-123',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'chat:read',
      },
    });

    await svc.exchangeCode('code-abc', 'channel-1', 'https://example.com/callback');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://id.kick.com/oauth/token',
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': expect.stringContaining('urlencoded') }),
      }),
    );
    expect(crypto.encryptField).toHaveBeenCalledWith('acc-123');
    expect(crypto.encryptField).toHaveBeenCalledWith('ref-123');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('lança se KICK_CLIENT_ID não configurado', async () => {
    const svc = new KickOAuthService(
      makeTokenRepo() as never,
      makeCrypto() as never,
      makeConfig({ KICK_CLIENT_ID: '' }) as never,
    );
    await expect(svc.exchangeCode('code', 'ch', 'https://example.com/cb')).rejects.toThrow(
      'não configurados',
    );
  });
});

describe('KickOAuthService — getValidToken', () => {
  it('retorna token plaintext se não expirado', async () => {
    const tokenEntity = {
      getAccessToken: () => 'enc:fresh-token',
      getRefreshToken: () => 'enc:refresh',
      getExpiresAt: () => new Date(Date.now() + 30 * 60 * 1000),
      getChannelId: () => 'ch-1',
      getPlatform: () => 'kick',
      getId: () => 'tok-1',
      getScope: () => 'chat:read',
      getUpdatedAt: () => new Date(),
      isExpired: () => false,
      isInvalidated: () => false,
      getInvalidatedAt: () => undefined,
    };
    const repo = makeTokenRepo(tokenEntity);
    const crypto = makeCrypto();
    const svc = new KickOAuthService(repo as never, crypto as never, makeConfig() as never);

    const token = await svc.getValidToken('ch-1');
    expect(token).toBe('fresh-token');
    expect(crypto.decryptField).toHaveBeenCalledWith('enc:fresh-token');
  });

  it('lança se token não encontrado', async () => {
    const svc = makeService(makeTokenRepo(null));
    await expect(svc.getValidToken('ch-inexistente')).rejects.toThrow('não encontrado');
  });
});
