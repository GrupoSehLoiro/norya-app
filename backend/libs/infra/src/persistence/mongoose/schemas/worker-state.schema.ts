/**
 * Schema Mongoose para `worker_states` — estado dos workers por canal.
 *
 * Usado pelo OrchestratorService para persistir estado entre restarts da API,
 * permitindo ao ReconcilerService detectar workers órfãos ou canais sem worker.
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const WorkerStateSchemaName = 'WorkerState';

export type WorkerRunState = 'starting' | 'running' | 'stopping' | 'crashed';
export type OrchestratorBackend = 'child_process' | 'dockerode';

@Schema({
  collection: 'worker_states',
  timestamps: { createdAt: 'startedAt', updatedAt: 'updatedAt' },
})
export class WorkerStatePersistence {
  @Prop({ type: String, required: true, unique: true, index: true })
  channelId!: string;

  @Prop({ type: String, enum: ['starting', 'running', 'stopping', 'crashed'], required: true })
  state!: WorkerRunState;

  @Prop({ type: String, enum: ['child_process', 'dockerode'], default: 'child_process' })
  backend!: OrchestratorBackend;

  @Prop({ type: Number })
  pid?: number;

  @Prop({ type: String })
  containerId?: string;

  @Prop({ type: Date })
  lastHeartbeatAt?: Date;

  startedAt?: Date;
  updatedAt?: Date;
}

export type WorkerStateDocument = HydratedDocument<WorkerStatePersistence>;

export const WorkerStateSchema = SchemaFactory.createForClass(WorkerStatePersistence);
