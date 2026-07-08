import { SubscriptionRenewerService, type RenewerStats } from '@sehloro/infra';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { SubscriptionRenewerCron } from './subscription-renewer.cron';

describe('SubscriptionRenewerCron', () => {
  let renewer: jest.Mocked<SubscriptionRenewerService>;
  let flags: jest.Mocked<FeatureFlagsService>;
  let cron: SubscriptionRenewerCron;

  beforeEach(() => {
    renewer = {
      renewAll: jest.fn(),
    } as unknown as jest.Mocked<SubscriptionRenewerService>;
    flags = {
      isEnabled: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<FeatureFlagsService>;
    cron = new SubscriptionRenewerCron(renewer, flags);
  });

  it('chama renewAll quando a flag está ligada', async () => {
    const stats: RenewerStats = {
      channelsScanned: 1,
      channelsRenewed: 1,
      channelsFailed: 0,
      errors: [],
    };
    renewer.renewAll.mockResolvedValue(stats);

    const result = await cron.runOnce();
    expect(result).toEqual(stats);
    expect(renewer.renewAll).toHaveBeenCalled();
  });

  it('skip quando flag desligada', async () => {
    flags.isEnabled.mockResolvedValueOnce(false);
    const result = await cron.runOnce();
    expect(result).toBeNull();
    expect(renewer.renewAll).not.toHaveBeenCalled();
  });

  it('engole erro do renewer e devolve null', async () => {
    renewer.renewAll.mockRejectedValueOnce(new Error('boom'));
    const result = await cron.runOnce();
    expect(result).toBeNull();
  });
});
