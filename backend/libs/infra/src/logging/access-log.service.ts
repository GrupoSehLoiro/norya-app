/**
 * AccessLogService — grava access logs no Mongo, fire-and-forget.
 *
 * `record()` NUNCA propaga erro nem bloqueia o caminho da request/evento:
 * logging é observabilidade, não regra de negócio. Falha vira um warn
 * (com rate implícito baixo — Mongo fora derruba muito mais que isso).
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AccessLogPersistence,
  AccessLogSchemaName,
  type AccessLogSource,
} from '../persistence/mongoose/schemas/access-log.schema';

export interface AccessLogEntry {
  service: AccessLogSource;
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs?: number;
  ip?: string;
  userAgent?: string;
  userId?: string | null;
  traceId?: string;
  at?: Date;
}

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    @InjectModel(AccessLogSchemaName)
    private readonly model: Model<AccessLogPersistence>,
  ) {}

  /** Fire-and-forget: agenda o insert e retorna imediatamente. */
  record(entry: AccessLogEntry): void {
    void this.model
      .create({
        service: entry.service,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode,
        responseTimeMs: entry.responseTimeMs ?? 0,
        ip: entry.ip ?? '',
        userAgent: entry.userAgent ?? '',
        userId: entry.userId ?? null,
        traceId: entry.traceId ?? '',
        at: entry.at ?? new Date(),
      })
      .catch((err: Error) => {
        this.logger.warn(`Falha ao gravar access log: ${err.message}`);
      });
  }

  /**
   * Consulta paginada com filtros. Usada pelo GET /api/v2/logs.
   * `path` é substring case-insensitive (escapada — nunca regex crua).
   */
  async query(params: {
    service?: AccessLogSource;
    method?: string;
    status?: number;
    statusGte?: number;
    path?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<{ total: number; items: AccessLogPersistence[] }> {
    const filter: Record<string, unknown> = {};
    if (params.service) filter.service = params.service;
    if (params.method) filter.method = params.method.toUpperCase();
    if (params.status !== undefined) filter.statusCode = params.status;
    else if (params.statusGte !== undefined) filter.statusCode = { $gte: params.statusGte };
    if (params.path) {
      const escaped = params.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.path = { $regex: escaped, $options: 'i' };
    }
    if (params.from || params.to) {
      const at: Record<string, Date> = {};
      if (params.from) at.$gte = params.from;
      if (params.to) at.$lte = params.to;
      filter.at = at;
    }

    const limit = Math.min(500, Math.max(1, params.limit ?? 100));
    const [total, items] = await Promise.all([
      this.model.countDocuments(filter).exec(),
      this.model.find(filter).sort({ at: -1 }).limit(limit).lean().exec(),
    ]);
    return { total, items: items as AccessLogPersistence[] };
  }
}
