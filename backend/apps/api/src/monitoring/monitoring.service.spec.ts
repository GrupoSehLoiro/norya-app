import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Channel,
  ChannelRepository,
  EventBus,
  LiveSession,
  LiveSessionRepository,
} from '@sehloro/domain';
import { MonitoringService } from './monitoring.service';

function makeChannel(): Channel {
  return Channel.reconstitute({
    id: 'chan-1',
    name: 'rogerbatt',
    platform: 'twitch',
    active: true,
    createdAt: new Date(),
    externalId: '999',
    displayName: 'rogerbatt',
    ownerId: 'owner-1',
    flags: {},
  });
}

describe('MonitoringService', () => {
  let sessions: jest.Mocked<LiveSessionRepository>;
  let channels: jest.Mocked<ChannelRepository>;
  let bus: jest.Mocked<EventBus>;
  let service: MonitoringService;

  beforeEach(() => {
    sessions = {
      findById: jest.fn(),
      findActiveByChannel: jest.fn(),
      findMany: jest.fn(),
      save: jest.fn().mockImplementation(async (s: LiveSession) => s),
      delete: jest.fn(),
    } as unknown as jest.Mocked<LiveSessionRepository>;

    channels = {
      findById: jest.fn(),
      findByName: jest.fn(),
      findAllActive: jest.fn(),
      findMany: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ChannelRepository>;

    bus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<EventBus>;

    // 4º arg = Redis do heartbeat de atividade (opcional em runtime; null aqui).
    service = new MonitoringService(sessions, channels, bus, null);
  });

  describe('startSession', () => {
    it('cria + salva + publica LiveSessionStarted quando não há ACTIVE', async () => {
      channels.findById.mockResolvedValue(makeChannel());
      sessions.findActiveByChannel.mockResolvedValue(null);

      const result = await service.startSession({ channelId: 'chan-1', autoStarted: false });

      expect(result.isActive()).toBe(true);
      expect(result.getChannelId()).toBe('chan-1');
      expect(sessions.save).toHaveBeenCalled();
      expect(bus.publish).toHaveBeenCalledWith(
        'monitoring.live-session',
        expect.objectContaining({ type: 'LiveSessionStarted', channelId: 'chan-1' }),
      );
    });

    it('é idempotente — devolve a sessão ACTIVE existente sem criar nova', async () => {
      channels.findById.mockResolvedValue(makeChannel());
      const existing = LiveSession.create({ channelId: 'chan-1', platform: 'twitch' });
      existing.start();
      sessions.findActiveByChannel.mockResolvedValue(existing);

      const result = await service.startSession({ channelId: 'chan-1', autoStarted: true });

      expect(result.getId()).toBe(existing.getId());
      expect(sessions.save).not.toHaveBeenCalled();
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('rejeita com 404 quando o canal não existe', async () => {
      channels.findById.mockResolvedValue(null);
      await expect(service.startSession({ channelId: 'ghost' })).rejects.toThrow(NotFoundException);
    });

    it('startSessionStrict lança ConflictException quando há ACTIVE', async () => {
      channels.findById.mockResolvedValue(makeChannel());
      const existing = LiveSession.create({ channelId: 'chan-1', platform: 'twitch' });
      existing.start();
      sessions.findActiveByChannel.mockResolvedValue(existing);

      await expect(service.startSessionStrict({ channelId: 'chan-1' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('endSession', () => {
    it('encerra ACTIVE e publica LiveSessionEnded', async () => {
      const session = LiveSession.create({ channelId: 'chan-1', platform: 'twitch' });
      session.start();
      sessions.findById.mockResolvedValue(session);

      const ended = await service.endSession(session.getId(), 'manual');

      expect(ended.getState()).toBe('ENDED');
      expect(ended.getSummary()).toBe('manual');
      expect(bus.publish).toHaveBeenCalledWith(
        'monitoring.live-session',
        expect.objectContaining({ type: 'LiveSessionEnded' }),
      );
    });

    it('é no-op quando a sessão já está ENDED', async () => {
      const session = LiveSession.create({ channelId: 'chan-1', platform: 'twitch' });
      session.start();
      session.end();
      sessions.findById.mockResolvedValue(session);

      await service.endSession(session.getId());

      expect(sessions.save).not.toHaveBeenCalled();
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('rejeita com 404 quando sessão não existe', async () => {
      sessions.findById.mockResolvedValue(null);
      await expect(service.endSession('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('endActiveByChannel', () => {
    it('encerra a sessão ACTIVE do canal e devolve', async () => {
      const session = LiveSession.create({ channelId: 'chan-1', platform: 'twitch' });
      session.start();
      sessions.findActiveByChannel.mockResolvedValue(session);
      sessions.findById.mockResolvedValue(session);

      const ended = await service.endActiveByChannel('chan-1', 'auto');

      expect(ended?.getState()).toBe('ENDED');
      expect(ended?.getSummary()).toBe('auto');
    });

    it('devolve null se não há ACTIVE', async () => {
      sessions.findActiveByChannel.mockResolvedValue(null);
      expect(await service.endActiveByChannel('chan-1')).toBeNull();
    });
  });

  describe('assertChannelOwner', () => {
    it('admin passa mesmo sem ser owner', async () => {
      channels.findById.mockResolvedValue(makeChannel());
      const channel = await service.assertChannelOwner('chan-1', 'other-user', 'admin');
      expect(channel.getId()).toBe('chan-1');
    });

    it('owner passa', async () => {
      channels.findById.mockResolvedValue(makeChannel());
      const channel = await service.assertChannelOwner('chan-1', 'owner-1', 'user');
      expect(channel.getId()).toBe('chan-1');
    });

    it('outro user vê 404 (não vaza existência)', async () => {
      channels.findById.mockResolvedValue(makeChannel());
      await expect(service.assertChannelOwner('chan-1', 'random', 'user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('falha no publish do bus não derruba o startSession (best-effort)', async () => {
    channels.findById.mockResolvedValue(makeChannel());
    sessions.findActiveByChannel.mockResolvedValue(null);
    bus.publish.mockRejectedValueOnce(new Error('redis down'));

    const result = await service.startSession({ channelId: 'chan-1' });
    expect(result.isActive()).toBe(true);
  });
});
