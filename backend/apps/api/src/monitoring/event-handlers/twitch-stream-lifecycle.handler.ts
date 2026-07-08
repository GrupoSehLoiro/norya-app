/**
 * MON-03 · TwitchStreamLifecycleHandler.
 *
 * Subscreve nos channels `twitch.stream.online` e `twitch.stream.offline`
 * do EventBus (publicados pelo worker — apps/worker/src/ingestion/...) e
 * traduz cada notification em uma transição de LiveSession via MonitoringService.
 *
 * Idempotência:
 *  - Online repetido pra mesmo canal já ACTIVE: MonitoringService.startSession
 *    devolve a existente com log; este handler não força nada.
 *  - Offline sem ACTIVE: endActiveByChannel devolve null; loga e segue.
 *
 * Gating:
 *  - Flag `monitoring.autoStart` (default true via FF-02). Se desligada para
 *    o canal específico, ignora o evento.
 *
 * Lookup canal externalId → channelId interno: feito via ChannelRepository.
 * Se não acharmos o canal correspondente no Mongo, logamos warn (a Twitch pode
 * ter mandado evento de um canal que ainda não foi onboardado aqui).
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  ChannelRepository,
  EVENT_BUS_TOKEN,
  EventBus,
  STREAM_OFFLINE_CHANNEL,
  STREAM_ONLINE_CHANNEL,
  TwitchStreamOfflinePayload,
  TwitchStreamOnlinePayload,
  Unsubscribe,
} from '@sehloro/domain';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { MonitoringService } from '../monitoring.service';

const AUTO_START_FLAG = 'monitoring.autoStart';

@Injectable()
export class TwitchStreamLifecycleHandler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TwitchStreamLifecycleHandler.name);
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    private readonly monitoring: MonitoringService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.unsubscribers.push(
      await this.bus.subscribe<TwitchStreamOnlinePayload>(STREAM_ONLINE_CHANNEL, (payload) =>
        this._handleOnline(payload).catch((err: unknown) =>
          this.logger.error(`Falha ao processar ${STREAM_ONLINE_CHANNEL}`, err),
        ),
      ),
    );
    this.unsubscribers.push(
      await this.bus.subscribe<TwitchStreamOfflinePayload>(STREAM_OFFLINE_CHANNEL, (payload) =>
        this._handleOffline(payload).catch((err: unknown) =>
          this.logger.error(`Falha ao processar ${STREAM_OFFLINE_CHANNEL}`, err),
        ),
      ),
    );
    this.logger.log(`Subscrito em ${STREAM_ONLINE_CHANNEL} + ${STREAM_OFFLINE_CHANNEL}`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      try {
        await unsub();
      } catch {
        // ignore — shutdown best-effort
      }
    }
    this.unsubscribers = [];
  }

  private async _handleOnline(payload: TwitchStreamOnlinePayload): Promise<void> {
    const channel = await this._resolveChannel(payload.channelExternalId);
    if (!channel) return;

    const enabled = await this.flags.isEnabled(AUTO_START_FLAG, { channelId: channel.getId() });
    if (!enabled) {
      this.logger.log(
        `[skip] flag ${AUTO_START_FLAG} desligada para canal ${channel.getId()} (${payload.broadcasterUserLogin})`,
      );
      return;
    }

    await this.monitoring.startSession({
      channelId: channel.getId(),
      autoStarted: true,
      source: 'twitch.eventsub',
    });
  }

  private async _handleOffline(payload: TwitchStreamOfflinePayload): Promise<void> {
    const channel = await this._resolveChannel(payload.channelExternalId);
    if (!channel) return;

    const enabled = await this.flags.isEnabled(AUTO_START_FLAG, { channelId: channel.getId() });
    if (!enabled) {
      this.logger.log(
        `[skip] flag ${AUTO_START_FLAG} desligada — não fechando sessão de ${channel.getId()} automaticamente`,
      );
      return;
    }

    const ended = await this.monitoring.endActiveByChannel(
      channel.getId(),
      'fechada por stream.offline',
    );
    if (!ended) {
      this.logger.log(
        `[skip] não há LiveSession ACTIVE para canal ${channel.getId()} (${payload.broadcasterUserLogin})`,
      );
    }
  }

  private async _resolveChannel(externalId: string) {
    // findMany permite filtrar por platform — usamos isso para distinguir entre
    // um canal Twitch com externalId X e qualquer outro caso colidisse.
    const page = await this.channels.findMany({ platform: 'twitch', pageSize: 100 });
    const match = page.channels.find((c) => c.getExternalId() === externalId);
    if (!match) {
      this.logger.warn(
        `Recebi stream lifecycle para externalId=${externalId} mas não tenho Channel local correspondente`,
      );
      return null;
    }
    return match;
  }
}
