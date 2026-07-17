/**
 * SessionHelixReconcilerCron — reconcilia as LiveSessions com a verdade da
 * Twitch (Helix /streams) a cada minuto.
 *
 * Complementa o EventSub, que é o caminho rápido mas pode falhar em silêncio:
 * canal sem subscriptions (desconectado/reconectado no meio da live), worker
 * fora do ar na hora do evento, sessão aberta manualmente. Com o reconciler,
 * o status "AO VIVO" do console converge em ≤60s nas duas direções:
 *  - sessão ACTIVE cujo canal NÃO está mais live no Helix → fecha;
 *  - canal twitch ativo que ESTÁ live no Helix sem sessão → abre (mesmo gate
 *    de flag `monitoring.autoStart` do handler EventSub).
 *
 * Custo: 1 request Helix por canal twitch ativo por minuto (app token; retry
 * de 429 já tratado no TwitchHelixService). Erro em um canal não interrompe
 * os demais; erro geral nunca propaga para fora do cron.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CHANNEL_REPOSITORY,
  LIVE_SESSION_REPOSITORY,
  type Channel,
  type ChannelRepository,
  type LiveSessionRepository,
} from '@sehloro/domain';
import { TwitchHelixService } from '@sehloro/infra';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { MonitoringService } from './monitoring.service';

const AUTO_START_FLAG = 'monitoring.autoStart';
export const RECONCILE_SUMMARY = 'fechada por reconciliação Helix (stream offline)';

@Injectable()
export class SessionHelixReconcilerCron {
  private readonly logger = new Logger(SessionHelixReconcilerCron.name);
  private running = false;

  constructor(
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    @Inject(LIVE_SESSION_REPOSITORY)
    private readonly sessions: LiveSessionRepository,
    private readonly monitoring: MonitoringService,
    private readonly flags: FeatureFlagsService,
    private readonly helix: TwitchHelixService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    // Guard de reentrância: Helix lento não pode empilhar varreduras.
    if (this.running) return;
    this.running = true;
    try {
      await this._run();
    } catch (err) {
      this.logger.error(`Reconciliação Helix falhou: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async _run(): Promise<void> {
    const all = await this.channels.findAllActive();
    const twitch = all.filter((c) => c.getPlatform() === 'twitch' && c.getExternalId());
    for (const channel of twitch) {
      try {
        await this._reconcileChannel(channel);
      } catch (err) {
        this.logger.warn(
          `reconcile falhou channel=${channel.getName()}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async _reconcileChannel(channel: Channel): Promise<void> {
    const stream = await this.helix.getStream(channel.getExternalId()!);
    const isLive = stream?.isLive === true;
    const active = await this.sessions.findActiveByChannel(channel.getId());

    if (active && !isLive) {
      await this.monitoring.endSession(active.getId(), RECONCILE_SUMMARY);
      this.logger.log(`offline no Helix → sessão fechada channel=${channel.getName()}`);
      return;
    }

    if (!active && isLive) {
      const enabled = await this.flags.isEnabled(AUTO_START_FLAG, {
        channelId: channel.getId(),
      });
      if (!enabled) return;
      // startSession é idempotente — se o EventSub abrir no meio tempo, no-op.
      await this.monitoring.startSession({
        channelId: channel.getId(),
        title: stream?.title,
        autoStarted: true,
        source: 'helix.reconciler',
      });
      this.logger.log(`live no Helix → sessão aberta channel=${channel.getName()}`);
    }
  }
}
