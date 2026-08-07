/**
 * BatchMessages — snapshot das mensagens unique processadas em um
 * batch do orchestrator. Salvo após o aggregate, antes do
 * BatchAnalysisWriter — é o "lado humano" do batch (vs. o batch_analysis
 * no ClickHouse que é o lado analítico).
 *
 * Decisão: Mongo (não ClickHouse) — volume baixo (1 doc por batch por
 * canal ~ 4/min), queries de "abrir batch X" são point-lookup por id.
 * TTL 7 dias pra controle de tamanho — histórico longo continua via
 * batch_analysis (CH, 180d).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export const BatchMessagesSchemaName = 'BatchMessages';

interface PersistedMessage {
  id: string;
  username: string;
  displayName?: string;
  isSubscriber: boolean;
  isMod: boolean;
  text: string;
  receivedAt: Date;
  sentimentHint?: string;
  emotes?: string[];
}

@Schema({
  collection: 'batch_messages',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class BatchMessagesPersistence {
  @Prop({ type: String, required: true, unique: true, index: true })
  batchId!: string;

  @Prop({ type: String, required: true, index: true })
  channelId!: string;

  @Prop({ type: Date, required: true, index: true })
  windowStart!: Date;

  @Prop({ type: Date, required: true })
  windowEnd!: Date;

  @Prop({ type: SchemaTypes.Mixed, default: [] })
  messages!: PersistedMessage[];

  /** Telemetria fácil — mostra na linha sem precisar abrir o batch. */
  @Prop({ type: Number, default: 0 })
  messageCount!: number;

  @Prop({ type: Number, default: 0 })
  uniqueUsers!: number;

  /**
   * Insight IA do bloco (BatchInsightService), gerado UMA vez no primeiro
   * clique e servido daqui depois — o conteúdo do batch é imutável, então
   * re-pagar o LLM a cada clique/viewer era custo puro. Ausente = nunca pedido.
   */
  @Prop({ type: String })
  aiInsight?: string;

  @Prop({ type: Date })
  aiInsightAt?: Date;
}

export type BatchMessagesDocument = HydratedDocument<BatchMessagesPersistence>;
export const BatchMessagesSchema = SchemaFactory.createForClass(BatchMessagesPersistence);

// TTL — 7 dias após createdAt. Volume baixo mas evita crescer indefinido.
BatchMessagesSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
// Index pra listar batches de um canal por janela desc.
BatchMessagesSchema.index({ channelId: 1, windowStart: -1 });
