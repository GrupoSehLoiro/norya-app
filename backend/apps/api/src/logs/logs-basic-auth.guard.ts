/**
 * Guard de HTTP Basic Auth para o endpoint de logs.
 *
 * Credencial ÚNICA e operacional, vinda do ambiente (LOGS_USER +
 * LOGS_PASSWORD no .env) — deliberadamente separada do JWT do produto:
 * quem inspeciona logs em homolog não precisa de conta no console, e a
 * credencial pode ser trocada/revogada sem tocar em usuários.
 *
 * Sem as duas envs setadas o endpoint fica DESLIGADO (404, não 401 —
 * não anuncia que existe). Comparação em tempo constante para não
 * vazar prefixo por timing.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Compara contra si mesmo para manter o custo constante.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

@Injectable()
export class LogsBasicAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedUser = this.config.get<string>('LOGS_USER');
    const expectedPassword = this.config.get<string>('LOGS_PASSWORD');
    if (!expectedUser || !expectedPassword) {
      throw new NotFoundException();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : '';
      const password = sep >= 0 ? decoded.slice(sep + 1) : '';
      const userOk = safeEquals(user, expectedUser);
      const passOk = safeEquals(password, expectedPassword);
      if (userOk && passOk) return true;
    }

    // WWW-Authenticate faz curl/navegador pedirem credencial.
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('WWW-Authenticate', 'Basic realm="sehloro-logs"');
    throw new UnauthorizedException('Credencial de logs inválida');
  }
}
