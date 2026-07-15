/**
 * Heartbeat do worker orquestrado.
 *
 * Quando o worker sobe como processo filho do OrchestratorService (env
 * CHANNEL_ID presente), renova `worker_states.lastHeartbeatAt` a cada
 * HEARTBEAT_INTERVAL_MS para o ReconcilerService saber que ele está vivo —
 * sem isso o Reconciler não tem sinal de saúde e não pode detectar stall.
 *
 * No worker standalone do compose (sem CHANNEL_ID) o serviço é no-op.
 */
import {
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PersistenceModule,
  WorkerStatePersistence,
  WorkerStateSchema,
  WorkerStateSchemaName,
} from '@sehloro/infra';

/** Deve ser < HEARTBEAT_STALE_MS/2 do Reconciler (60 s) para tolerar um tick perdido. */
const HEARTBEAT_INTERVAL_MS = 15_000;

@Injectable()
export class WorkerHeartbeatService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(WorkerStateSchemaName)
    private readonly workerStateModel: Model<WorkerStatePersistence>,
  ) {}

  onApplicationBootstrap(): void {
    const channelId = process.env['CHANNEL_ID'];
    if (!channelId) return; // worker standalone — ninguém consome heartbeat

    const beat = (): void => {
      this.workerStateModel
        .updateOne({ channelId }, { $set: { lastHeartbeatAt: new Date() } })
        .exec()
        .catch((err: unknown) =>
          this.logger.warn(`heartbeat falhou para ${channelId}: ${String(err)}`),
        );
    };

    beat();
    this.timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    // Não segura o event loop: um shutdown não deve esperar o próximo tick.
    this.timer.unref();
    this.logger.log(`Heartbeat ativo para canal ${channelId} (${HEARTBEAT_INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

@Module({
  imports: [
    PersistenceModule,
    MongooseModule.forFeature([{ name: WorkerStateSchemaName, schema: WorkerStateSchema }]),
  ],
  providers: [WorkerHeartbeatService],
})
export class WorkerHeartbeatModule {}
