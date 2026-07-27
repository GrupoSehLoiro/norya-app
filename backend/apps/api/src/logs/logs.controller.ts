/**
 * GET /api/v2/logs — consulta de access logs (API + worker).
 *
 * Protegido pelo JWT do produto (JwtAuthGuard global) + role=admin inline —
 * mesmo padrão do AdminUsersController/FeatureFlagsController. A antiga
 * credencial Basic operacional (LOGS_USER/LOGS_PASSWORD) foi removida: quem
 * já é admin no console vê os logs sem um segundo login. Consumido pela
 * página /logs do console.
 *
 * Filtros (todos opcionais, combináveis):
 *   ?service=api|worker    origem
 *   ?method=GET            verbo (EVENT para worker)
 *   ?status=404            status exato — OU —
 *   ?statusGte=400         status mínimo (ex.: só erros)
 *   ?path=/api/v2/channels substring case-insensitive do path
 *   ?from=ISO&to=ISO       janela temporal
 *   ?limit=100             máx. 500
 */
import { BadRequestException, Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { AccessLogService, type AccessLogSource } from '@sehloro/infra';
import { CurrentUser, type AuthUser } from '../identity/auth/decorators/current-user.decorator';

@Controller('v2/logs')
export class LogsController {
  constructor(private readonly accessLog: AccessLogService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('service') service?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('statusGte') statusGte?: string,
    @Query('path') path?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    if (user?.role !== 'admin') throw new ForbiddenException();
    if (service && service !== 'api' && service !== 'worker') {
      throw new BadRequestException('service deve ser "api" ou "worker"');
    }
    const result = await this.accessLog.query({
      service: service as AccessLogSource | undefined,
      method,
      status: _int(status, 'status'),
      statusGte: _int(statusGte, 'statusGte'),
      path,
      from: _date(from, 'from'),
      to: _date(to, 'to'),
      limit: _int(limit, 'limit'),
    });
    return result;
  }
}

function _int(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`${name} inválido`);
  return n;
}

function _date(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} inválido (use ISO 8601)`);
  return d;
}
