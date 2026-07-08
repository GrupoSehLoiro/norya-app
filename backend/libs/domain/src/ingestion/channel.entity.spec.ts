/**
 * Testes de unidade da entidade Channel.
 */
import { Channel, InvalidChannelError } from './channel.entity';

describe('Channel entity', () => {
  describe('create', () => {
    it('default active=true e createdAt agora', () => {
      const before = Date.now();
      const c = Channel.create({ name: 'foo', platform: 'twitch' });
      const after = Date.now();

      expect(c.isActive()).toBe(true);
      expect(c.getCreatedAt().getTime()).toBeGreaterThanOrEqual(before);
      expect(c.getCreatedAt().getTime()).toBeLessThanOrEqual(after);
    });

    it('rejeita name vazio', () => {
      expect(() => Channel.create({ name: '', platform: 'twitch' })).toThrow(InvalidChannelError);
    });

    it('rejeita platform fora do enum', () => {
      expect(() =>
        Channel.create({
          name: 'x',
          // força tipo inválido
          platform: 'youtube' as unknown as 'twitch',
        }),
      ).toThrow(InvalidChannelError);
    });
  });

  describe('getChannelWithPrefix', () => {
    it('Twitch: #name', () => {
      const c = Channel.create({ name: 'abc', platform: 'twitch' });
      expect(c.getChannelWithPrefix()).toBe('#abc');
    });
    it('Kick: #name (uniformidade frontend)', () => {
      const c = Channel.create({ name: 'abc', platform: 'kick' });
      expect(c.getChannelWithPrefix()).toBe('#abc');
    });
  });

  describe('toPersistence', () => {
    it('usa nomes legados', () => {
      const createdAt = new Date('2025-01-01T00:00:00.000Z');
      const c = Channel.reconstitute({
        id: 'id',
        name: 'n',
        platform: 'twitch',
        active: false,
        createdAt,
      });
      const p = c.toPersistence();
      expect(p._id).toBe('id');
      expect(p.channel).toBe('n');
      expect(p.channelWithPrefix).toBe('#n');
      expect(p.created_at).toBe(createdAt);
      expect(p.active).toBe(false);
    });
  });
});
