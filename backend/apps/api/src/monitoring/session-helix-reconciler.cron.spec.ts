import { Channel, LiveSession } from '@sehloro/domain';
import { RECONCILE_SUMMARY, SessionHelixReconcilerCron } from './session-helix-reconciler.cron';

function makeChannel(name: string, opts: { externalId?: string; platform?: string } = {}): Channel {
  return Channel.reconstitute({
    id: `chan-${name}`,
    name,
    platform: (opts.platform ?? 'twitch') as 'twitch',
    active: true,
    createdAt: new Date(),
    externalId: opts.externalId,
  });
}

function makeActiveSession(channelId: string): LiveSession {
  const s = LiveSession.create({ channelId, platform: 'twitch' });
  s.start();
  return s;
}

function makeCron(opts: {
  channels?: Channel[];
  activeByChannel?: Record<string, LiveSession | null>;
  liveByExternalId?: Record<string, boolean>;
  flagEnabled?: boolean;
}) {
  const channels = {
    findAllActive: jest.fn().mockResolvedValue(opts.channels ?? []),
  };
  const sessions = {
    findActiveByChannel: jest
      .fn()
      .mockImplementation((id: string) => Promise.resolve(opts.activeByChannel?.[id] ?? null)),
  };
  const monitoring = {
    endSession: jest.fn().mockResolvedValue(undefined),
    startSession: jest.fn().mockResolvedValue(undefined),
  };
  const flags = {
    isEnabled: jest.fn().mockResolvedValue(opts.flagEnabled ?? true),
  };
  const helix = {
    getStream: jest.fn().mockImplementation((externalId: string) => {
      const live = opts.liveByExternalId?.[externalId];
      return Promise.resolve(live ? { isLive: true, viewerCount: 10, title: 'live!' } : null);
    }),
  };
  const cron = new SessionHelixReconcilerCron(
    channels as never,
    sessions as never,
    monitoring as never,
    flags as never,
    helix as never,
  );
  return { cron, channels, sessions, monitoring, flags, helix };
}

describe('SessionHelixReconcilerCron', () => {
  it('fecha sessão ACTIVE quando o Helix diz offline', async () => {
    const ch = makeChannel('slplataformay', { externalId: '1520172659' });
    const active = makeActiveSession(ch.getId());
    const { cron, monitoring } = makeCron({
      channels: [ch],
      activeByChannel: { [ch.getId()]: active },
      liveByExternalId: {},
    });

    await cron.sweep();

    expect(monitoring.endSession).toHaveBeenCalledWith(active.getId(), RECONCILE_SUMMARY);
    expect(monitoring.startSession).not.toHaveBeenCalled();
  });

  it('abre sessão quando o Helix diz live e não há ACTIVE (flag ligada)', async () => {
    const ch = makeChannel('slplataformay', { externalId: '1520172659' });
    const { cron, monitoring } = makeCron({
      channels: [ch],
      liveByExternalId: { '1520172659': true },
    });

    await cron.sweep();

    expect(monitoring.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: ch.getId(),
        autoStarted: true,
        source: 'helix.reconciler',
      }),
    );
    expect(monitoring.endSession).not.toHaveBeenCalled();
  });

  it('NÃO abre sessão com a flag monitoring.autoStart desligada', async () => {
    const ch = makeChannel('slplataformay', { externalId: '1520172659' });
    const { cron, monitoring } = makeCron({
      channels: [ch],
      liveByExternalId: { '1520172659': true },
      flagEnabled: false,
    });

    await cron.sweep();

    expect(monitoring.startSession).not.toHaveBeenCalled();
  });

  it('estado já consistente → não mexe em nada', async () => {
    const ch = makeChannel('slplataformay', { externalId: '1520172659' });
    const active = makeActiveSession(ch.getId());
    const { cron, monitoring } = makeCron({
      channels: [ch],
      activeByChannel: { [ch.getId()]: active },
      liveByExternalId: { '1520172659': true },
    });

    await cron.sweep();

    expect(monitoring.endSession).not.toHaveBeenCalled();
    expect(monitoring.startSession).not.toHaveBeenCalled();
  });

  it('ignora canais não-twitch e sem externalId; erro num canal não para os demais', async () => {
    const kick = makeChannel('kickch', { platform: 'kick', externalId: '9' });
    const semExt = makeChannel('semext');
    const quebra = makeChannel('quebra', { externalId: 'err-1' });
    const ok = makeChannel('ok', { externalId: 'ok-1' });
    const okActive = makeActiveSession(ok.getId());

    const { cron, monitoring, helix } = makeCron({
      channels: [kick, semExt, quebra, ok],
      activeByChannel: { [ok.getId()]: okActive },
      liveByExternalId: {},
    });
    helix.getStream.mockImplementation((externalId: string) => {
      if (externalId === 'err-1') return Promise.reject(new Error('helix 500'));
      return Promise.resolve(null);
    });

    await cron.sweep();

    // kick e sem-externalId nem consultam o Helix.
    expect(helix.getStream).toHaveBeenCalledTimes(2);
    // o erro em "quebra" não impediu o fechamento de "ok".
    expect(monitoring.endSession).toHaveBeenCalledWith(okActive.getId(), RECONCILE_SUMMARY);
  });
});
