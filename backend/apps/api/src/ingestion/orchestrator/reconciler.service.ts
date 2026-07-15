/**
 * ORC-04 · ReconcilerService.
 *
 * Loop periódico (15 s) que garante que:
 *  - Todo canal `active=true` tem um worker rodando.
 *  - Todo worker sem canal ativo correspondente é encerrado.
 *  - Workers com lastHeartbeatAt > 60 s são reiniciados (stalled).
 *
 * Controlado pela feature flag `reconciler.enabled` (default true).
 * Desabilitar via env RECONCILER_ENABLED=false em dev se necessário.
 *
 * Heartbeat: o processo filho renova `lastHeartbeatAt` em `worker_states`
 * a cada 15 s (WorkerHeartbeatService em apps/worker). O Orchestrator semeia
 * o campo no spawn; stalled = heartbeat mais velho que HEARTBEAT_STALE_MS.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Inject } from '@nestjs/common';
import { CHANNEL_REPOSITORY, ChannelRepository } from '@sehloro/domain';
import { OrchestratorService } from './orchestrator.service';

const HEARTBEAT_STALE_MS = 60_000;
const RECONCILE_INTERVAL_MS = 15_000;

@Injectable()
export class ReconcilerService {
  private readonly logger = new Logger(ReconcilerService.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channelRepo: ChannelRepository,
    private readonly orchestrator: OrchestratorService,
  ) {
    this.enabled = process.env['RECONCILER_ENABLED'] !== 'false';
    if (!this.enabled) this.logger.warn('ReconcilerService desabilitado via env');
  }

  @Interval(RECONCILE_INTERVAL_MS)
  async reconcile(): Promise<void> {
    if (!this.enabled) return;

    try {
      const [activeChannels, runningWorkers] = await Promise.all([
        this.channelRepo.findAllActive(),
        this.orchestrator.list(),
      ]);

      const activeIds = new Set(activeChannels.map((c) => c.getId()));
      const workerMap = new Map(runningWorkers.map((w) => [w.channelId, w]));

      // Canal ativo sem worker → start
      for (const channel of activeChannels) {
        const worker = workerMap.get(channel.getId());
        if (!worker || worker.state === 'crashed') {
          this.logger.log(`Reconciler: canal ${channel.getName()} sem worker → start`);
          await this.orchestrator
            .start(channel.getId())
            .catch((err: unknown) =>
              this.logger.error(`Falha ao iniciar worker para ${channel.getId()}`, err),
            );
        }
      }

      // Worker sem canal ativo → stop
      for (const worker of runningWorkers) {
        if (!activeIds.has(worker.channelId) && worker.state === 'running') {
          this.logger.log(`Reconciler: worker órfão ${worker.channelId} → stop`);
          await this.orchestrator
            .stop(worker.channelId)
            .catch((err: unknown) =>
              this.logger.error(`Falha ao parar worker órfão ${worker.channelId}`, err),
            );
        }
      }

      // Worker stalled (running mas sem heartbeat recente) → restart.
      // O critério é o lastHeartbeatAt (semeado no spawn e renovado pelo
      // WorkerHeartbeatService do processo filho) — NUNCA startedAt: idade não
      // é sinal de travamento, e usar startedAt aqui reiniciava todo worker
      // saudável com >60s de vida a cada tick, vazando processos órfãos.
      // Docs legados sem lastHeartbeatAt são ignorados (sem churn).
      const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_MS);
      for (const worker of runningWorkers) {
        if (
          worker.state === 'running' &&
          activeIds.has(worker.channelId) &&
          worker.lastHeartbeatAt &&
          worker.lastHeartbeatAt < staleThreshold
        ) {
          this.logger.warn(`Reconciler: worker stalled ${worker.channelId} → restart`);
          await this.orchestrator
            .restart(worker.channelId)
            .catch((err: unknown) =>
              this.logger.error(`Falha ao reiniciar worker stalled ${worker.channelId}`, err),
            );
        }
      }
    } catch (err) {
      this.logger.error('Erro no loop de reconciliação', err);
    }
  }
}
