import { LiveSession, LiveSessionRepository } from '@sehloro/domain';
import {
  STALE_SUMMARY,
  STALE_THRESHOLD_MS,
  SessionStaleCloserCron,
} from './session-stale-closer.cron';
import { MonitoringService } from './monitoring.service';

function makeStaleSession(id: string): LiveSession {
  const s = LiveSession.create({ channelId: `chan-${id}`, platform: 'twitch' });
  s.start();
  return s;
}

describe('SessionStaleCloserCron', () => {
  let sessions: jest.Mocked<LiveSessionRepository>;
  let monitoring: jest.Mocked<MonitoringService>;
  let cron: SessionStaleCloserCron;

  beforeEach(() => {
    sessions = {
      findStaleActive: jest.fn(),
      findById: jest.fn(),
      findActiveByChannel: jest.fn(),
      findMany: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<LiveSessionRepository>;

    monitoring = {
      endSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MonitoringService>;

    cron = new SessionStaleCloserCron(sessions, monitoring);
  });

  it('passa o threshold de 15min atrás para o repositório', async () => {
    sessions.findStaleActive.mockResolvedValue([]);
    const now = new Date('2026-05-11T12:00:00Z');

    await cron.sweep(now);

    expect(sessions.findStaleActive).toHaveBeenCalledTimes(1);
    const passed = sessions.findStaleActive.mock.calls[0]![0];
    expect(passed.toISOString()).toBe(new Date(now.getTime() - STALE_THRESHOLD_MS).toISOString());
  });

  it('encerra cada sessão stale com o summary canônico', async () => {
    const stale = [makeStaleSession('a'), makeStaleSession('b'), makeStaleSession('c')];
    sessions.findStaleActive.mockResolvedValue(stale);

    const result = await cron.sweep();

    expect(result.closed).toBe(3);
    expect(monitoring.endSession).toHaveBeenCalledTimes(3);
    for (const s of stale) {
      expect(monitoring.endSession).toHaveBeenCalledWith(s.getId(), STALE_SUMMARY);
    }
  });

  it('isola falhas individuais — uma sessão que quebra não impede as outras', async () => {
    const stale = [makeStaleSession('a'), makeStaleSession('b'), makeStaleSession('c')];
    sessions.findStaleActive.mockResolvedValue(stale);
    monitoring.endSession
      .mockResolvedValueOnce(undefined as unknown as LiveSession)
      .mockRejectedValueOnce(new Error('mongo down'))
      .mockResolvedValueOnce(undefined as unknown as LiveSession);

    const result = await cron.sweep();

    expect(result.closed).toBe(2); // só as que deram certo
    expect(monitoring.endSession).toHaveBeenCalledTimes(3);
  });

  it('no-op quando não há sessão stale', async () => {
    sessions.findStaleActive.mockResolvedValue([]);
    const result = await cron.sweep();
    expect(result.closed).toBe(0);
    expect(monitoring.endSession).not.toHaveBeenCalled();
  });
});
