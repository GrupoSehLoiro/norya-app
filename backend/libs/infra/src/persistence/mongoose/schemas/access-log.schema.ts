/**
 * Schema Mongoose para access logs — "quem acessou o quê, quando".
 *
 * Um doc por request HTTP na API (gravado por middleware, então cobre
 * também respostas de guard/4xx) e um por evento EventSub relevante no
 * worker (method='EVENT'). Consultável em GET /api/v2/logs e na página
 * /logs do console.
 *
 * TTL de 14 dias via índice `expireAfterSeconds` em `at` — access log é
 * dado operacional, não histórico de produto. O path é gravado SEM query
 * string (callbacks OAuth carregam code/state na query).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const AccessLogSchemaName = 'AccessLog';

export const ACCESS_LOG_TTL_SECONDS = 14 * 24 * 60 * 60;

export type AccessLogSource = 'api' | 'worker';

@Schema({
  collection: 'access_logs',
  timestamps: false,
  versionKey: false,
})
export class AccessLogPersistence {
  /** Origem: 'api' (HTTP) ou 'worker' (eventos EventSub/ingest). */
  @Prop({ type: String, required: true })
  service!: AccessLogSource;

  /** Verbo HTTP, ou 'EVENT' para notificações do worker. */
  @Prop({ type: String, required: true })
  method!: string;

  /** Path sem query string (ex.: /api/v2/channels) ou /eventsub/<type>. */
  @Prop({ type: String, required: true })
  path!: string;

  @Prop({ type: Number, required: true })
  statusCode!: number;

  /** Latência em ms (0 para eventos do worker). */
  @Prop({ type: Number, default: 0 })
  responseTimeMs!: number;

  @Prop({ type: String, default: '' })
  ip!: string;

  @Prop({ type: String, default: '' })
  userAgent!: string;

  /** userId autenticado (CLS), quando houver. */
  @Prop({ type: String, default: null })
  userId!: string | null;

  /** traceId propagado pelo pino/CLS — correlaciona com o log JSON. */
  @Prop({ type: String, default: '' })
  traceId!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at!: Date;
}

export type AccessLogDocument = HydratedDocument<AccessLogPersistence>;

export const AccessLogSchema = SchemaFactory.createForClass(AccessLogPersistence);

AccessLogSchema.index({ at: -1 });
AccessLogSchema.index({ service: 1, at: -1 });
AccessLogSchema.index({ at: 1 }, { expireAfterSeconds: ACCESS_LOG_TTL_SECONDS });
