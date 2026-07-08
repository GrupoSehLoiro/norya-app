/**
 * Testes unitários de ChannelOAuthToken.
 */
import { ChannelOAuthToken, InvalidChannelOAuthTokenError } from './channel-oauth-token.entity';

describe('ChannelOAuthToken entity', () => {
  const baseProps = {
    channelId: 'ch-1',
    platform: 'twitch' as const,
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  };

  describe('create', () => {
    it('gera id e updatedAt; default scope vazio', () => {
      const t = ChannelOAuthToken.create(baseProps);
      expect(t.getId()).toBeTruthy();
      expect(t.getScope()).toBe('');
      expect(t.getUpdatedAt()).toBeInstanceOf(Date);
    });

    it('rejeita channelId vazio', () => {
      expect(() => ChannelOAuthToken.create({ ...baseProps, channelId: '' })).toThrow(
        InvalidChannelOAuthTokenError,
      );
    });

    it('rejeita platform fora do enum', () => {
      expect(() =>
        ChannelOAuthToken.create({
          ...baseProps,
          platform: 'youtube' as unknown as 'twitch',
        }),
      ).toThrow(InvalidChannelOAuthTokenError);
    });

    it('rejeita accessToken vazio', () => {
      expect(() => ChannelOAuthToken.create({ ...baseProps, accessToken: '' })).toThrow(
        InvalidChannelOAuthTokenError,
      );
    });

    it('rejeita refreshToken vazio', () => {
      expect(() => ChannelOAuthToken.create({ ...baseProps, refreshToken: '' })).toThrow(
        InvalidChannelOAuthTokenError,
      );
    });

    it('rejeita expiresAt inválido', () => {
      expect(() =>
        ChannelOAuthToken.create({
          ...baseProps,
          expiresAt: new Date('invalid'),
        }),
      ).toThrow(InvalidChannelOAuthTokenError);
    });
  });

  describe('isExpired', () => {
    it('true quando expiresAt no passado', () => {
      const t = ChannelOAuthToken.create({
        ...baseProps,
        expiresAt: new Date('2000-01-01'),
      });
      expect(t.isExpired()).toBe(true);
    });

    it('false quando expiresAt no futuro', () => {
      const t = ChannelOAuthToken.create({
        ...baseProps,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(t.isExpired()).toBe(false);
    });
  });

  describe('toPersistence', () => {
    it('retorna shape com plaintext (crypto é concern de infra)', () => {
      const t = ChannelOAuthToken.reconstitute({
        id: 'id-1',
        channelId: 'ch-1',
        platform: 'twitch',
        accessToken: 'plain-access',
        refreshToken: 'plain-refresh',
        scope: 's',
        expiresAt: new Date('2030-01-01'),
        updatedAt: new Date('2025-01-01'),
      });
      const p = t.toPersistence();
      expect(p.accessToken).toBe('plain-access');
      expect(p.refreshToken).toBe('plain-refresh');
      expect(p.platform).toBe('twitch');
    });
  });
});
