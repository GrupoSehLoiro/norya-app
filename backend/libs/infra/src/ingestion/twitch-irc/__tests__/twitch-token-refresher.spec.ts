/**
 * Testes do TwitchTokenRefresher (TWI-04).
 * Cobre: happy path, refresh token inválido, race de N chamadas concorrentes.
 */
import axios from 'axios';
import { ChannelOAuthToken, ChannelOAuthTokenRepository } from '@sehloro/domain';
import { CryptoService } from '../../../crypto/crypto.service';
import {
  TWITCH_TOKEN_EVENTS,
  TwitchTokenEvent,
  TwitchTokenRefresher,
} from '../twitch-token-refresher';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const MASTER_KEY = Buffer.alloc(32, 0x42).toString('base64');
const crypto = new CryptoService({ masterKeyBase64: MASTER_KEY });

function makeToken(
  overrides: Partial<{
    expiresAt: Date;
    invalidatedAt: Date;
  }> = {},
): ChannelOAuthToken {
  return ChannelOAuthToken.reconstitute({
    id: 'tok-1',
    channelId: 'ch-1',
    platform: 'twitch',
    accessToken: crypto.encrypt('old-access'),
    refreshToken: crypto.encrypt('old-refresh'),
    scope: 'chat:read',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() - 1000), // expirado
    updatedAt: new Date(),
    invalidatedAt: overrides.invalidatedAt,
  });
}

function makeRepo(saved: ChannelOAuthToken[] = []): ChannelOAuthTokenRepository {
  return {
    findByChannelId: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (t: ChannelOAuthToken) => {
      saved.push(t);
      return t;
    }),
    delete: jest.fn(),
  };
}

function makeRefresher(repo: ChannelOAuthTokenRepository): TwitchTokenRefresher {
  return new TwitchTokenRefresher(repo, crypto, 'client-id', 'client-secret');
}

describe('TwitchTokenRefresher', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('renova o token e persiste novo par encriptado', async () => {
      const saved: ChannelOAuthToken[] = [];
      const repo = makeRepo(saved);
      const refresher = makeRefresher(repo);

      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 },
      });

      const result = await refresher.refreshIfNeeded(makeToken());

      expect(result).toBeDefined();
      expect(repo.save).toHaveBeenCalledTimes(1);

      // Verifica que o accessToken salvo é ciphertext (encriptado)
      const savedToken = saved[0];
      expect(savedToken.getAccessToken()).toMatch(/^v1:/);
    });

    it('emite TwitchTokenRefreshedEvent', async () => {
      const refresher = makeRefresher(makeRepo());
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: 'new', refresh_token: 'new-r', expires_in: 3600 },
      });

      const events: TwitchTokenEvent[] = [];
      refresher.events.on(TWITCH_TOKEN_EVENTS, (e: TwitchTokenEvent) => events.push(e));

      await refresher.refreshIfNeeded(makeToken());

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('refreshed');
      expect(events[0].channelId).toBe('ch-1');
    });

    it('não faz request quando token ainda válido (> 5min)', async () => {
      const refresher = makeRefresher(makeRepo());
      const validToken = makeToken({ expiresAt: new Date(Date.now() + 10 * 60 * 1000) });

      const result = await refresher.refreshIfNeeded(validToken);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result).toBe(validToken);
    });
  });

  describe('refresh token inválido (400/401)', () => {
    it('em 400 persiste invalidatedAt e emite TwitchTokenInvalidEvent', async () => {
      const saved: ChannelOAuthToken[] = [];
      const refresher = makeRefresher(makeRepo(saved));

      mockedAxios.post.mockRejectedValueOnce(
        Object.assign(new Error('Bad Request'), {
          isAxiosError: true,
          response: { status: 400 },
        }),
      );

      const events: TwitchTokenEvent[] = [];
      refresher.events.on(TWITCH_TOKEN_EVENTS, (e: TwitchTokenEvent) => events.push(e));

      await expect(refresher.refreshIfNeeded(makeToken())).rejects.toThrow(
        'TwitchTokenInvalidError',
      );

      expect(saved[0].isInvalidated()).toBe(true);
      expect(events[0].type).toBe('invalid');
    });

    it('em 401 mesmo comportamento de invalidação', async () => {
      const refresher = makeRefresher(makeRepo());
      mockedAxios.post.mockRejectedValueOnce(
        Object.assign(new Error('Unauthorized'), {
          isAxiosError: true,
          response: { status: 401 },
        }),
      );

      await expect(refresher.refreshIfNeeded(makeToken())).rejects.toThrow(
        'TwitchTokenInvalidError',
      );
    });
  });

  describe('race condition — N chamadas concorrentes', () => {
    it('N chamadas simultâneas para o mesmo canal fazem apenas 1 request HTTP', async () => {
      const refresher = makeRefresher(makeRepo());
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new', refresh_token: 'new-r', expires_in: 3600 },
      });

      const token = makeToken();
      const results = await Promise.all([
        refresher.refreshIfNeeded(token),
        refresher.refreshIfNeeded(token),
        refresher.refreshIfNeeded(token),
      ]);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      // Todos devem retornar a mesma instância
      expect(results[0]).toBe(results[1]);
      expect(results[1]).toBe(results[2]);
    });

    it('canais diferentes fazem requests independentes', async () => {
      const refresher = makeRefresher(makeRepo());
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new', refresh_token: 'new-r', expires_in: 3600 },
      });

      const token1 = makeToken();
      const token2 = ChannelOAuthToken.reconstitute({
        id: 'tok-2',
        channelId: 'ch-2', // canal diferente
        platform: 'twitch',
        accessToken: crypto.encrypt('access'),
        refreshToken: crypto.encrypt('refresh'),
        scope: '',
        expiresAt: new Date(Date.now() - 1000),
        updatedAt: new Date(),
      });

      await Promise.all([refresher.refreshIfNeeded(token1), refresher.refreshIfNeeded(token2)]);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });
  });
});
