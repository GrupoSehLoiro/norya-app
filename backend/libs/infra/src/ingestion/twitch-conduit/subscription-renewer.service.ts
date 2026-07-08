/**
 * CON-05 · SubscriptionRenewerService.
 *
 * Recria subscriptions EventSub que perderam o status `enabled` — seja
 * porque o handler de revocation marcou local como `revoked`, seja porque
 * a Twitch dropou silenciosamente (caso raro mas possível).
 *
 * Estratégia:
 *  1. Carrega todos os canais Twitch ativos do CHANNEL_REPOSITORY.
 *  2. Para cada canal, lista as subscriptions locais (via repository de
 *     persistência) e checa se as 3 esperadas (channel.chat.message,
 *     stream.online, stream.offline) estão `enabled`.
 *  3. Se algum tipo está faltando ou marcado != `enabled`, chama
 *     `TwitchConduitSubscriptionsService.subscribeChannel` — idempotente,
 *     então re-subscrição funciona como upsert.
 *
 * O service em si é "puro": recebe deps via construtor (incluindo o
 * conduitId em runtime) e devolve estatísticas. O cron wrapper em
 * `apps/api` adiciona o gating de feature flag.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CHANNEL_REPOSITORY, Channel, ChannelRepository } from '@sehloro/domain';
import { TwitchConduitService } from './twitch-conduit.service';
import { TwitchConduitSubscriptionsService } from './twitch-conduit-subscriptions.service';
import type { EventSubSubscriptionType } from '../../persistence/mongoose/schemas/twitch-eventsub-subscription.schema';

const REQUIRED_TYPES: EventSubSubscriptionType[] = [
  'channel.chat.message',
  'stream.online',
  'stream.offline',
];

export interface RenewerStats {
  channelsScanned: number;
  channelsRenewed: number;
  channelsFailed: number;
  errors: Array<{ channelId: string; error: string }>;
}

@Injectable()
export class SubscriptionRenewerService {
  private readonly logger = new Logger(SubscriptionRenewerService.name);

  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    private readonly conduit: TwitchConduitService,
    private readonly subscriptions: TwitchConduitSubscriptionsService,
    /**
     * Bot user_id (do TwitchHelixService.getUserByLogin sobre o nome da
     * conta de bot) — obrigatório para criar channel.chat.message subscriptions.
     */
    private readonly botUserId: string,
  ) {}

  async renewAll(): Promise<RenewerStats> {
    const stats: RenewerStats = {
      channelsScanned: 0,
      channelsRenewed: 0,
      channelsFailed: 0,
      errors: [],
    };

    const page = await this.channels.findMany({
      platform: 'twitch',
      active: true,
      pageSize: 500,
    });

    if (page.channels.length === 0) return stats;

    let conduitId: string;
    try {
      conduitId = (await this.conduit.ensureConduit()).conduitId;
    } catch (err) {
      this.logger.error('ensureConduit falhou — abortando renew', (err as Error).message);
      throw err;
    }

    for (const channel of page.channels) {
      stats.channelsScanned++;
      try {
        const renewed = await this._renewChannel(channel, conduitId);
        if (renewed) stats.channelsRenewed++;
      } catch (err) {
        stats.channelsFailed++;
        stats.errors.push({ channelId: channel.getId(), error: (err as Error).message });
        this.logger.error(`Renew falhou para canal ${channel.getId()}`, (err as Error).stack);
      }
    }

    this.logger.log(
      `renewAll: scanned=${stats.channelsScanned} renewed=${stats.channelsRenewed} failed=${stats.channelsFailed}`,
    );
    return stats;
  }

  private async _renewChannel(channel: Channel, conduitId: string): Promise<boolean> {
    const externalId = channel.getExternalId();
    if (!externalId) {
      this.logger.warn(`Canal ${channel.getId()} sem externalId — pulando renew`);
      return false;
    }

    const local = await this.subscriptions.listActiveByChannel(channel.getId());
    const enabledByType = new Set(local.map((s) => s.type));

    const missingOrRevoked = REQUIRED_TYPES.filter((t) => !enabledByType.has(t));
    if (missingOrRevoked.length === 0) return false;

    this.logger.log(`Canal ${channel.getId()} precisa renovar: [${missingOrRevoked.join(', ')}]`);

    await this.subscriptions.subscribeChannel({
      channelId: channel.getId(),
      channelExternalId: externalId,
      conduitId,
      botUserId: this.botUserId,
    });
    return true;
  }
}
