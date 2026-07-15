/**
 * ORC-03 · OrchestratorService.
 *
 * Gerencia o ciclo de vida dos workers por canal. Cada canal ativo recebe um
 * processo filho dedicado (`child_process.fork`). Em produção o backend pode
 * ser trocado para Dockerode via `ORCHESTRATOR_BACKEND=dockerode`.
 *
 * Estado persistido em Mongo (`worker_states`) para o ReconcilerService
 * (ORC-04) consistir após reinicializações da API.
 *
 * Contratos públicos:
 *  start(channelId)   — spawn ou no-op se já running
 *  stop(channelId)    — kill + remove state
 *  restart(channelId) — stop + start
 *  list()             — WorkerHandle[] de todos os registros conhecidos
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { fork, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  WorkerStatePersistence,
  WorkerStateSchemaName,
  WorkerRunState,
  OrchestratorBackend,
} from '@sehloro/infra';

export interface WorkerHandle {
  channelId: string;
  state: WorkerRunState;
  backend: OrchestratorBackend;
  startedAt?: Date;
  lastHeartbeatAt?: Date;
  pid?: number;
  containerId?: string;
}

const WORKER_CRASH_TIMEOUT_MS = 5_000;
const WORKER_STOP_GRACE_MS = 5_000;

@Injectable()
export class OrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly procs = new Map<string, ChildProcess>();
  private readonly backend: OrchestratorBackend;
  private readonly workerScript: string;

  constructor(
    @InjectModel(WorkerStateSchemaName)
    private readonly workerStateModel: Model<WorkerStatePersistence>,
    private readonly config: ConfigService,
  ) {
    this.backend =
      (this.config.get<string>('ORCHESTRATOR_BACKEND') as OrchestratorBackend) ?? 'child_process';

    // Resolve o script do worker relativo ao workspace root do monorepo.
    // Prefere o dist compilado se existir (containers de produção têm só
    // dist/); cai pro src com tsx apenas quando rodando do checkout em dev.
    const distPath = path.resolve(__dirname, '../../../../worker/dist/main.js');
    const srcPath = path.resolve(__dirname, '../../../../worker/src/main.ts');
    this.workerScript = fs.existsSync(distPath) ? distPath : srcPath;
  }

  async start(channelId: string): Promise<WorkerHandle> {
    const existing = await this.workerStateModel.findOne({ channelId }).exec();
    if (existing && existing.state === 'running') {
      const proc = this.procs.get(channelId);
      if (proc && !proc.killed) {
        this.logger.debug(`Worker já rodando para canal ${channelId}`);
        return this._toHandle(existing);
      }
    }

    this.logger.log(`Iniciando worker para canal ${channelId}`);

    const doc = await this.workerStateModel
      .findOneAndUpdate(
        { channelId },
        {
          $set: {
            channelId,
            state: 'starting' as WorkerRunState,
            backend: this.backend,
            pid: undefined,
            containerId: undefined,
            // Heartbeat "otimista" do spawn: dá ao processo filho a janela de
            // HEARTBEAT_STALE_MS para publicar o primeiro heartbeat real antes
            // de o Reconciler poder considerá-lo stalled.
            lastHeartbeatAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (this.backend === 'child_process') {
      return this._spawnChildProcess(channelId, doc!);
    }

    // Stub Dockerode — implementar quando backend=dockerode for necessário
    this.logger.warn(`Backend dockerode não implementado; usando child_process para ${channelId}`);
    return this._spawnChildProcess(channelId, doc!);
  }

  async stop(channelId: string): Promise<void> {
    this.logger.log(`Parando worker para canal ${channelId}`);

    const proc = this.procs.get(channelId);
    this.procs.delete(channelId);

    // Marca 'stopping' ANTES de sinalizar, para o handler de 'exit' do spawn
    // não classificar este encerramento como crash.
    await this.workerStateModel
      .findOneAndUpdate({ channelId }, { $set: { state: 'stopping' as WorkerRunState } })
      .exec();

    // `proc.killed` só indica que um sinal foi ENVIADO, não que o processo
    // morreu — testá-lo aqui anularia o fallback. O critério de "já morto" é
    // exitCode/signalCode; caso contrário espera o 'exit' real e escala para
    // SIGKILL se o graceful shutdown travar (ex.: Mongo fora, WS em reconnect).
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, WORKER_STOP_GRACE_MS);
        proc.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
        proc.kill('SIGTERM');
      });
    }

    await this.workerStateModel.deleteOne({ channelId }).exec();
  }

  async restart(channelId: string): Promise<WorkerHandle> {
    await this.stop(channelId);
    return this.start(channelId);
  }

  async list(): Promise<WorkerHandle[]> {
    const docs = await this.workerStateModel.find().exec();
    return docs.map((d) => this._toHandle(d));
  }

  onModuleDestroy(): void {
    for (const [channelId, proc] of this.procs.entries()) {
      if (!proc.killed) {
        this.logger.log(`Shutdown: encerrando worker ${channelId}`);
        proc.kill('SIGTERM');
      }
    }
    this.procs.clear();
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  private _spawnChildProcess(channelId: string, doc: WorkerStatePersistence): WorkerHandle {
    const execArgv = this.workerScript.endsWith('.ts') ? ['--import', 'tsx/esm'] : [];

    const proc = fork(this.workerScript, [], {
      execArgv,
      env: {
        ...process.env,
        CHANNEL_ID: channelId,
      },
      silent: false,
    });

    this.procs.set(channelId, proc);

    // Atualiza state para 'running' após fork bem-sucedido
    this.workerStateModel
      .findOneAndUpdate(
        { channelId },
        { $set: { state: 'running' as WorkerRunState, pid: proc.pid } },
      )
      .exec()
      .catch((err: unknown) =>
        this.logger.error(`Falha ao atualizar state do worker ${channelId}`, err),
      );

    proc.once('exit', (code) => {
      this.procs.delete(channelId);
      const crashed = code !== 0 && code !== null;
      this.logger.warn(
        `Worker ${channelId} encerrou (code=${String(code)}, crashed=${String(crashed)})`,
      );

      // Marca como crashed após WORKER_CRASH_TIMEOUT_MS se ainda constar no DB
      setTimeout(() => {
        this.workerStateModel
          .findOneAndUpdate(
            { channelId, state: { $ne: 'stopping' } },
            { $set: { state: 'crashed' as WorkerRunState } },
          )
          .exec()
          .catch(() => undefined);
      }, WORKER_CRASH_TIMEOUT_MS);
    });

    return {
      channelId,
      state: 'running',
      backend: 'child_process',
      startedAt: (doc as { startedAt?: Date }).startedAt,
      pid: proc.pid,
    };
  }

  private _toHandle(doc: WorkerStatePersistence): WorkerHandle {
    return {
      channelId: doc.channelId,
      state: doc.state,
      backend: doc.backend,
      startedAt: (doc as { startedAt?: Date }).startedAt,
      lastHeartbeatAt: doc.lastHeartbeatAt,
      pid: doc.pid,
      containerId: doc.containerId,
    };
  }
}
