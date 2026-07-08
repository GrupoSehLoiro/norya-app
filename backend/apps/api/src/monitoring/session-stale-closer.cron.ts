/**
 * MON-04 · SessionStaleCloserCron.
 *
 * A cada 10 minutos varre LiveSession ACTIVE com lastEventAt > 15 minutos
 * (ou, na ausência de lastEventAt, startedAt > 15 minutos). Cada uma é
 * encerrada via MonitoringService com summary `'fechada por inatividade'`.
 *
 * Por que: o handler stream.offline (MON-03) pode ser perdido — webhook
 * revogado, EventSub estourando, queda de Redis, etc. Sem o cron, uma
 * sessão fica ACTIVE eternamente e contamina toda a métrica downstream.
 *
 * Idempotência: `endSession` é no-op para sessões já ENDED, então rerun
 * acidental não causa problema.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LIVE_SESSION_REPOSITORY, LiveSessionRepository } from '@sehloro/domain';
import { MonitoringService } from './monitoring.service';

export const STALE_THRESHOLD_MS = 15 * 60 * 1000;
export const STALE_SUMMARY = 'fechada por inatividade';

@Injectable()
export class SessionStaleCloserCron {
  private readonly logger = new Logger(SessionStaleCloserCron.name);

  constructor(
    @Inject(LIVE_SESSION_REPOSITORY)
    private readonly sessions: LiveSessionRepository,
    private readonly monitoring: MonitoringService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(now: Date = new Date()): Promise<{ closed: number }> {
    const threshold = new Date(now.getTime() - STALE_THRESHOLD_MS);
    const stale = await this.sessions.findStaleActive(threshold);
    if (stale.length === 0) return { closed: 0 };

    this.logger.warn(`Encontradas ${stale.length} sessões ACTIVE paradas — fechando`);
    let closed = 0;
    for (const session of stale) {
      try {
        await this.monitoring.endSession(session.getId(), STALE_SUMMARY);
        closed++;
      } catch (err) {
        this.logger.error(`Falha ao fechar sessão stale ${session.getId()}`, (err as Error).stack);
      }
    }
    this.logger.log(`${closed}/${stale.length} sessões stale fechadas`);
    return { closed };
  }
}
