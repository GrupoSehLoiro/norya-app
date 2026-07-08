/**
 * Testes do TwitchHelixService (TWI-03).
 * Mocka axios para não fazer chamadas reais à Twitch API.
 */
import axios from 'axios';
import { TwitchHelixService } from '../twitch-helix.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const MOCK_TOKEN = 'mock-app-token';

function makeService(): TwitchHelixService {
  return new TwitchHelixService(CLIENT_ID, CLIENT_SECRET);
}

function mockTokenResponse() {
  mockedAxios.post.mockResolvedValueOnce({
    data: { access_token: MOCK_TOKEN, expires_in: 3600 },
  });
}

function mockHttpInstance(mockGetImpl: jest.Mock): void {
  mockedAxios.create.mockReturnValue({
    request: mockGetImpl,
  } as unknown as ReturnType<typeof axios.create>);
}

describe('TwitchHelixService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStream — happy path', () => {
    it('retorna dados do stream quando canal está ao vivo', async () => {
      const mockRequest = jest.fn().mockResolvedValueOnce({
        data: {
          data: [
            {
              type: 'live',
              viewer_count: 5000,
              game_id: '512710',
              started_at: '2026-05-01T20:00:00Z',
              title: 'Ranked grind',
            },
          ],
        },
      });
      mockHttpInstance(mockRequest);
      mockTokenResponse();

      const service = makeService();
      const result = await service.getStream('123456');

      expect(result).not.toBeNull();
      expect(result!.isLive).toBe(true);
      expect(result!.viewerCount).toBe(5000);
      expect(result!.gameId).toBe('512710');
      expect(result!.startedAt).toBeInstanceOf(Date);
    });

    it('retorna null quando canal está offline (data vazio)', async () => {
      const mockRequest = jest.fn().mockResolvedValueOnce({ data: { data: [] } });
      mockHttpInstance(mockRequest);
      mockTokenResponse();

      const service = makeService();
      expect(await service.getStream('123456')).toBeNull();
    });
  });

  describe('getUserByLogin — happy path', () => {
    it('retorna dados do usuário', async () => {
      const mockRequest = jest.fn().mockResolvedValueOnce({
        data: {
          data: [{ id: 'u1', login: 'rogerbatt', display_name: 'RogerBatt' }],
        },
      });
      mockHttpInstance(mockRequest);
      mockTokenResponse();

      const service = makeService();
      const user = await service.getUserByLogin('rogerbatt');

      expect(user).not.toBeNull();
      expect(user!.login).toBe('rogerbatt');
      expect(user!.displayName).toBe('RogerBatt');
    });

    it('retorna null quando login não encontrado', async () => {
      const mockRequest = jest.fn().mockResolvedValueOnce({ data: { data: [] } });
      mockHttpInstance(mockRequest);
      mockTokenResponse();

      const service = makeService();
      expect(await service.getUserByLogin('naoexiste')).toBeNull();
    });
  });

  describe('401 — refresh de token + retry', () => {
    it('em 401 força refresh do app token e retenta', async () => {
      const err401 = Object.assign(new Error('Unauthorized'), {
        isAxiosError: true,
        response: { status: 401, headers: {} },
      });
      const mockRequest = jest
        .fn()
        .mockRejectedValueOnce(err401)
        .mockResolvedValueOnce({
          data: { data: [{ id: 'u1', login: 'test', display_name: 'Test' }] },
        });
      mockHttpInstance(mockRequest);
      // Dois posts de token: inicial + refresh após 401
      mockedAxios.post
        .mockResolvedValueOnce({ data: { access_token: 'token-1', expires_in: 3600 } })
        .mockResolvedValueOnce({ data: { access_token: 'token-2', expires_in: 3600 } });

      const service = makeService();
      const user = await service.getUserByLogin('test');

      expect(user).not.toBeNull();
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('429 — respeita Retry-After', () => {
    it('em 429 com Retry-After aguarda e retenta', async () => {
      jest.useFakeTimers();
      const err429 = Object.assign(new Error('Too Many Requests'), {
        isAxiosError: true,
        response: { status: 429, headers: { 'retry-after': '0.01' } },
      });
      const mockRequest = jest
        .fn()
        .mockRejectedValueOnce(err429)
        .mockResolvedValueOnce({ data: { data: [] } });
      mockHttpInstance(mockRequest);
      mockedAxios.post.mockResolvedValue({ data: { access_token: MOCK_TOKEN, expires_in: 3600 } });

      const service = makeService();
      const promise = service.getStream('123');
      await jest.runAllTimersAsync();
      await promise;

      expect(mockRequest).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('getAppAccessToken', () => {
    it('reutiliza token cacheado sem novo POST', async () => {
      const mockRequest = jest.fn().mockResolvedValue({ data: { data: [] } });
      mockHttpInstance(mockRequest);
      mockedAxios.post.mockResolvedValue({ data: { access_token: MOCK_TOKEN, expires_in: 3600 } });

      const service = makeService();
      await service.getStream('u1');
      await service.getStream('u2');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });
  });
});
