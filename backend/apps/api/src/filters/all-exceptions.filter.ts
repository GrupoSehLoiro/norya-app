import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { ZodError } from 'zod';
import { isDomainError } from '@sehloro/domain';
import type { Request, Response } from 'express';

/**
 * Shape canônico de resposta de erro.
 * Consumido pelo frontend do SLMOD e pelos contract tests em /contract-tests.
 */
interface ErrorResponseBody {
  statusCode: number;
  message: string;
  code: string;
  traceId: string | undefined;
  issues?: unknown;
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * Mongo duplicate-key error carrega `code` numérico (11000) mas não é
 * instância de uma classe específica que exportamos aqui — mongoose é
 * opcional no M1, então detectamos por duck typing.
 */
interface MongoLikeError {
  name?: string;
  code?: number;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

function isMongoDuplicateKeyError(err: unknown): err is MongoLikeError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as MongoLikeError;
  return (e.name === 'MongoServerError' || e.name === 'MongoError') && e.code === 11000;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = this.cls.getId();

    const body = this.buildBody(exception, traceId);

    // Log estruturado do erro (5xx em error, 4xx em warn)
    const logPayload = {
      traceId,
      path: request?.url,
      method: request?.method,
      statusCode: body.statusCode,
      code: body.code,
    };
    if (body.statusCode >= 500) {
      this.logger.error(
        `${body.code} ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
        JSON.stringify(logPayload),
      );
    } else {
      this.logger.warn(`${body.code} ${body.message} ${JSON.stringify(logPayload)}`);
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(exception: unknown, traceId: string | undefined): ErrorResponseBody {
    const isProd = process.env.NODE_ENV === 'production';

    // 1) Erros de domínio — classe base em @sehloro/domain
    if (isDomainError(exception)) {
      return {
        statusCode: exception.statusCode,
        message: exception.message,
        code: exception.code,
        traceId,
        details: exception.details,
        ...(isProd ? {} : { stack: exception.stack }),
      };
    }

    // 2) ZodError — validação de input (request body/query/params ou config)
    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validação falhou',
        code: 'VALIDATION_ERROR',
        traceId,
        issues: exception.issues,
        ...(isProd ? {} : { stack: exception.stack }),
      };
    }

    // 3) Mongo duplicate key (E11000) — mapeia para 409
    if (isMongoDuplicateKeyError(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'Registro duplicado',
        code: 'DUPLICATE_KEY',
        traceId,
        details: {
          keyPattern: exception.keyPattern,
          keyValue: exception.keyValue,
        },
        ...(isProd ? {} : { stack: (exception as Error).stack }),
      };
    }

    // 4) HttpException — preserva status/message originais do Nest
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : (raw as { message?: string | string[] }).message
            ? Array.isArray((raw as { message: string[] }).message)
              ? (raw as { message: string[] }).message.join('; ')
              : ((raw as { message: string }).message as string)
            : exception.message;
      const code =
        typeof raw === 'object' && raw !== null && 'code' in raw
          ? String((raw as { code: unknown }).code)
          : this.statusToCode(status);
      return {
        statusCode: status,
        message,
        code,
        traceId,
        ...(isProd ? {} : { stack: exception.stack }),
      };
    }

    // 5) Fallback — 500
    const stack = exception instanceof Error ? exception.stack : undefined;
    const message = exception instanceof Error ? exception.message : 'Erro interno';
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProd ? 'Erro interno do servidor' : message,
      code: 'INTERNAL_ERROR',
      traceId,
      ...(isProd ? {} : { stack }),
    };
  }

  private statusToCode(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE_ENTITY';
      case 429:
        return 'TOO_MANY_REQUESTS';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
    }
  }
}
