/**
 * ChannelLinkBackfill — unit (repos + CreatorService mockados).
 *
 * Cenários: 1 creator → vincula; 0 creators → cria creator e vincula;
 * memberships ambíguas → skip; erro num canal não interrompe os demais.
 */
import { Channel } from '@sehloro/domain';
import { ChannelLinkBackfill } from './channel-link.backfill';

function makeChannel(name: string, ownerId: string | undefined): Channel {
  return Channel.reconstitute({
    id: `ch-${name}`,
    name,
    platform: 'twitch',
    active: true,
    createdAt: new Date(),
    displayName: name.toUpperCase(),
    ownerId,
  });
}

function membership(workspaceId: string, status = 'active') {
  return { getWorkspaceId: () => workspaceId, getStatus: () => status };
}

function makeBackfill(opts: {
  orphans: Channel[];
  membershipsByUser?: Record<string, unknown[]>;
  autoLink?: jest.Mock;
  create?: jest.Mock;
  link?: jest.Mock;
}) {
  const channels = { findUnlinkedOwned: jest.fn().mockResolvedValue(opts.orphans) };
  const memberships = {
    findByUserId: jest
      .fn()
      .mockImplementation((userId: string) =>
        Promise.resolve(opts.membershipsByUser?.[userId] ?? []),
      ),
  };
  const creators = {
    autoLinkIntegration: opts.autoLink ?? jest.fn().mockResolvedValue('linked'),
    create: opts.create ?? jest.fn().mockResolvedValue({ id: 'cr-new', name: 'Novo' }),
    linkIntegration: opts.link ?? jest.fn().mockResolvedValue({}),
  };
  const backfill = new ChannelLinkBackfill(
    channels as never,
    memberships as never,
    creators as never,
  );
  return { backfill, channels, memberships, creators };
}

describe('ChannelLinkBackfill', () => {
  it('workspace com 1 creator → vincula via autoLinkIntegration', async () => {
    const { backfill, creators } = makeBackfill({
      orphans: [makeChannel('slplataformay', 'user-1')],
      membershipsByUser: { 'user-1': [membership('ws-1')] },
    });
    await backfill.onApplicationBootstrap();
    expect(creators.autoLinkIntegration).toHaveBeenCalledWith('ws-1', 'user-1', 'ch-slplataformay');
    expect(creators.create).not.toHaveBeenCalled();
  });

  it('workspace sem creator → cria creator com nome do canal e vincula', async () => {
    const autoLink = jest.fn().mockResolvedValue('no-creator');
    const { backfill, creators } = makeBackfill({
      orphans: [makeChannel('slplataformay', 'user-1')],
      membershipsByUser: { 'user-1': [membership('ws-1')] },
      autoLink,
    });
    await backfill.onApplicationBootstrap();
    expect(creators.create).toHaveBeenCalledWith('ws-1', { name: 'SLPLATAFORMAY' });
    expect(creators.linkIntegration).toHaveBeenCalledWith(
      'cr-new',
      'ws-1',
      'user-1',
      'ch-slplataformay',
    );
  });

  it('dono com 0 ou 2+ memberships ativas → skip sem vincular', async () => {
    const { backfill, creators } = makeBackfill({
      orphans: [makeChannel('a', 'sem-ws'), makeChannel('b', 'multi-ws')],
      membershipsByUser: {
        'sem-ws': [membership('ws-x', 'revoked')],
        'multi-ws': [membership('ws-1'), membership('ws-2')],
      },
    });
    await backfill.onApplicationBootstrap();
    expect(creators.autoLinkIntegration).not.toHaveBeenCalled();
    expect(creators.create).not.toHaveBeenCalled();
  });

  it('erro num canal não interrompe os demais', async () => {
    const autoLink = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('linked');
    const { backfill, creators } = makeBackfill({
      orphans: [makeChannel('a', 'user-1'), makeChannel('b', 'user-1')],
      membershipsByUser: { 'user-1': [membership('ws-1')] },
      autoLink,
    });
    await backfill.onApplicationBootstrap();
    expect(creators.autoLinkIntegration).toHaveBeenCalledTimes(2);
  });
});
