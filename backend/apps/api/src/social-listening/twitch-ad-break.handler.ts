/**
 * Handler do EventSub `channel.ad_break.begin` (Twitch).
 *
 * Vive aqui como consumer do EventBus: o `TwitchEventSubBridge` (M3,
 * apps/worker) publica eventos no canal `twitch.eventsub.<type>` quando
 * recebe pacotes do conduit. Esse handler escuta `channel.ad_break.begin`
 * e cria um AdSegment via AdSegmentService.
 *
 * Caso o bridge ainda não esteja publicando (M3 não cobriu ad_break),
 * o handler simplesmente nunca dispara — manual toggle continua funcionando.
 */
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EVENT_BUS_TOKEN, type EventBus, type Unsubscribe } from '@sehloro/domain';
import { AdSegmentService } from './ad-segment.service';

interface TwitchAdBreakPayload {
  subscription?: { type?: string };
  event?: {
    broadcaster_user_id?: string;
    broadcaster_user_login?: string;
    duration_seconds?: number;
    started_at?: string;
    is_automatic?: boolean;
  };
}

@Injectable()
export class TwitchAdBreakHandler implements OnModuleInit {
  private readonly logger = new Logger(TwitchAdBreakHandler.name);
  private unsub?: Unsubscribe;

  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly ad: AdSegmentService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.unsub = await this.bus.subscribe<TwitchAdBreakPayload>(
      'twitch.eventsub.channel.ad_break.begin',
      (payload) =>
        this._handle(payload).catch((err) =>
          this.logger.error('Falha ao processar ad_break.begin', err),
        ),
    );
    this.logger.log('Subscrito em twitch.eventsub.channel.ad_break.begin');
  }

  private async _handle(payload: TwitchAdBreakPayload): Promise<void> {
    const ev = payload.event;
    if (!ev?.broadcaster_user_id || !ev?.duration_seconds || !ev?.started_at) {
      this.logger.warn('payload ad_break.begin incompleto, ignorando');
      return;
    }
    await this.ad.startFromTwitch({
      channelId: ev.broadcaster_user_id,
      startedAt: new Date(ev.started_at),
      durationSeconds: ev.duration_seconds,
      isAutomatic: ev.is_automatic ?? false,
      rawPayload: payload,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.unsub) await this.unsub();
  }
}
