/**
 * AccessLogMiddleware — grava um doc em `access_logs` por request HTTP.
 *
 * Middleware (e não interceptor) DE PROPÓSITO: interceptors não rodam
 * quando um guard rejeita, então 401/403 sumiriam do access log. Aqui o
 * hook é `res.on('finish')`, que dispara para toda resposta escrita —
 * sucesso, erro de guard, exception filter, tudo.
 *
 * O userId é lido do CLS DENTRO do finish (o guard de auth popula o CLS
 * depois do middleware rodar; no finish já está lá).
 *
 * Payloads: além dos metadados, o log carrega o que o usuário enviou
 * (query + body da request) e o que o servidor respondeu (body JSON,
 * capturado por patch em res.json). Sanitização/truncamento ficam no
 * AccessLogService (sanitizeLogPayload): senha, tokens, OAuth code/state
 * etc. viram [REDACTED] — nunca chegam ao Mongo.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AccessLogService } from '@sehloro/infra';

/** Preflight CORS não é acesso a recurso — só ruído. */
const SKIPPED_METHODS = new Set(['OPTIONS', 'HEAD']);

/**
 * Rotas cujo RESPONSE não é capturado: a listagem de logs devolve docs que
 * já contêm responseBody — capturá-la criaria logs-dentro-de-logs que
 * crescem a cada consulta da própria página /logs.
 */
const RESPONSE_CAPTURE_SKIP_PREFIXES = ['/api/v2/logs'];

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
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';

    // Captura o body JSON da response. Só res.json (res.send(obj) delega
    // para ele no Express) — SSE/binário/304 nunca passam por aqui e o
    // campo simplesmente não existe no doc.
    let responseBody: unknown;
    if (!RESPONSE_CAPTURE_SKIP_PREFIXES.some((p) => path.startsWith(p))) {
      const originalJson = res.json.bind(res);
      res.json = ((body: unknown) => {
        responseBody = body;
        return originalJson(body);
      }) as Response['json'];
    }

    res.on('finish', () => {
      try {
        const forwarded = (req.headers['x-forwarded-for'] as string | undefined)
          ?.split(',')[0]
          ?.trim();
        this.accessLog.record({
          service: 'api',
          method: req.method,
          path,
          statusCode: res.statusCode,
          responseTimeMs: Date.now() - startedAt,
          ip: forwarded ?? req.socket?.remoteAddress ?? '',
          userAgent: (req.headers['user-agent'] as string | undefined) ?? '',
          userId: this.cls.get<string | undefined>('userId') ?? null,
          traceId: this.cls.getId() ?? '',
          // Lidos no finish: o body-parser já rodou com certeza e req.body
          // reflete o que o handler viu.
          query: req.query,
          requestBody: req.body as unknown,
          responseBody,
        });
      } catch {
        // Access log nunca derruba a resposta — o record() já é
        // fire-and-forget; isto cobre só erro síncrono inesperado.
      }
    });

    next();
  }
}
