/**
 * Persistence handler para `channel.ban` EventSub.
 *
 * Distingue ban (permanente) de timeout (com `endsAt`) e grava na collection
 * legada correspondente (`bans` ou `timeouts`).
 *
 * Os campos preservam nomenclatura legada (`userName`, `modName`, `tempoDeTO`)
 * — bots antigos seguem escrevendo no mesmo formato. Ver docs/technical/legacy-module.md.
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  EVENT_BUS_TOKEN,
  EventBus,
  TWITCH_CHANNEL_BAN_CHANNEL,
  TwitchChannelBanPayload,
  Unsubscribe,
} from '@sehloro/domain';
import {
  BanPersistence,
  BanSchemaName,
  TimeoutPersistence,
  TimeoutSchemaName,
} from '@sehloro/infra';

@Injectable()
export class BanHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BanHandler.name);
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    @InjectModel(BanSchemaName) private readonly bans: Model<BanPersistence>,
    @InjectModel(TimeoutSchemaName) private readonly timeouts: Model<TimeoutPersistence>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribers.push(
      await this.bus.subscribe<TwitchChannelBanPayload>(TWITCH_CHANNEL_BAN_CHANNEL, (payload) =>
        this._handle(payload).catch((err: unknown) =>
          this.logger.error(`Falha ao processar ${TWITCH_CHANNEL_BAN_CHANNEL}`, err),
        ),
      ),
    );
    this.logger.log(`Subscrito em ${TWITCH_CHANNEL_BAN_CHANNEL} → bans/timeouts`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try {
        await unsub();
      } catch {
        // best-effort
      }
    }
    this.unsubscribers = [];
  }

  private async _handle(p: TwitchChannelBanPayload): Promise<void> {
    const timestamp = new Date(p.bannedAt);
    if (p.isPermanent || !p.endsAt) {
      await this.bans.create({
        channel: p.broadcasterUserLogin,
        userName: p.userLogin,
        reason: p.reason || '',
        modName: p.moderatorUserLogin || '',
        timestamp,
      });
      return;
    }
    const tempoDeTO = Math.max(
      0,
      Math.round((new Date(p.endsAt).getTime() - timestamp.getTime()) / 1000),
    );
    await this.timeouts.create({
      channel: p.broadcasterUserLogin,
      userName: p.userLogin,
      reason: p.reason || '',
      tempoDeTO,
      modName: p.moderatorUserLogin || '',
      timestamp,
    });
  }
}
