/**
 * AccessLogMiddleware — grava um doc em `access_logs` por request HTTP.
 *
 * Middleware (e não interceptor) DE PROPÓSITO: interceptors não rodam
 * quando um guard rejeita, então 401/403 sumiriam do access log. Aqui o
 * hook é `res.on('finish')`, que dispara para toda resposta escrita —
 * sucesso, erro de guard, exception filter, tudo.
 *
 * O userId é lido do CLS DENTRO do finish (o guard de auth popula o CLS
 * depois do middleware rodar; no finish já está lá). Query string nunca
 * é persistida (OAuth callbacks carregam code/state).
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AccessLogService } from '@sehloro/infra';

/** Preflight CORS não é acesso a recurso — só ruído. */
const SKIPPED_METHODS = new Set(['OPTIONS', 'HEAD']);

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  constructor(
    private readonly accessLog: AccessLogService,
    private readonly cls: ClsService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (SKIPPED_METHODS.has(req.method)) {
      next();
      return;
    }
    const startedAt = Date.now();

    res.on('finish', () => {
      try {
        const forwarded = (req.headers['x-forwarded-for'] as string | undefined)
          ?.split(',')[0]
          ?.trim();
        this.accessLog.record({
          service: 'api',
          method: req.method,
          path: (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '',
          statusCode: res.statusCode,
          responseTimeMs: Date.now() - startedAt,
          ip: forwarded ?? req.socket?.remoteAddress ?? '',
          userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
          userId: this.cls.get<string | undefined>('userId') ?? null,
          traceId: this.cls.getId() ?? '',
        });
      } catch {
        // Access log nunca derruba a resposta — o record() já é
        // fire-and-forget; isto cobre só erro síncrono inesperado.
      }
    });

    next();
  }
}
