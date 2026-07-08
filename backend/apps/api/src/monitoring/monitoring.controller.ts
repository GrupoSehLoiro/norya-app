/**
 * MON-02 · MonitoringController.
 *
 * Endpoints do bounded context Monitoring:
 *   POST   /api/v2/monitoring/sessions/start     — abre sessão manual
 *   POST   /api/v2/monitoring/sessions/:id/stop  — encerra
 *   GET    /api/v2/monitoring/sessions           — lista paginada
 *   GET    /api/v2/monitoring/sessions/:id       — detalhe
 *   GET    /api/v2/monitoring/ping               — health do contexto (public)
 *
 * Auth: JwtAuthGuard global, exceto o ping. Mutações exigem que o caller seja
 * dono do canal (ou admin).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { LiveSession } from '@sehloro/domain';
import { CurrentUser, AuthUser } from '../identity/auth/decorators/current-user.decorator';
import { Public } from '../identity/auth/decorators/public.decorator';
import { ListSessionsSchema } from './dto/list-sessions.dto';
import { StartSessionSchema } from './dto/start-session.dto';
import { MonitoringService } from './monitoring.service';

@Controller('v2/monitoring')
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}

  @Public()
  @Get('ping')
  ping(): { context: string; status: string } {
    return { context: 'monitoring', status: 'alive' };
  }

  @Post('sessions/start')
  @HttpCode(HttpStatus.CREATED)
  async startSession(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    if (!user) throw new BadRequestException('Auth obrigatória');

    const parsed = StartSessionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    await this.service.assertChannelOwner(parsed.data.channelId, user.sub, user.role);
    const session = await this.service.startSessionStrict({
      channelId: parsed.data.channelId,
      title: parsed.data.title,
      autoStarted: false,
      source: 'manual',
    });
    return serializeSession(session);
  }

  /**
   * Encerra uma sessão. POST por convenção (transição de estado), mas
   * também aceitamos DELETE para clientes que preferem REST puro.
   */
  @Post('sessions/:id/stop')
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async stopSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const session = await this.service.findById(id);
    await this.service.assertChannelOwner(session.getChannelId(), user.sub, user.role);
    const ended = await this.service.endSession(id);
    return serializeSession(ended);
  }

  @Get('sessions')
  async list(@Query() query: unknown, @CurrentUser() user: AuthUser) {
    const parsed = ListSessionsSchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    // Quando o caller pede um channelId específico, validamos ownership.
    if (parsed.data.channelId) {
      await this.service.assertChannelOwner(parsed.data.channelId, user.sub, user.role);
    }

    const { sessions, total } = await this.service.findMany(parsed.data);
    return {
      sessions: sessions.map(serializeSession),
      total,
    };
  }

  @Get('sessions/:id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const session = await this.service.findById(id);
    try {
      await this.service.assertChannelOwner(session.getChannelId(), user.sub, user.role);
    } catch {
      // Não vazar a existência da sessão para quem não é dono.
      throw new NotFoundException(`Sessão ${id} não encontrada`);
    }
    return serializeSession(session);
  }

  /**
   * Status conciso ONLINE/OFFLINE de um canal — pro console mostrar
   * banner "canal offline, sem extração de chat" quando aplicável.
   *
   * Auth global; sem owner-only porque é só status (não vaza chat).
   */
  @Get('channel-status/:channelId')
  async channelStatus(@Param('channelId') channelId: string) {
    const status = await this.service.getChannelStatus(channelId);
    return {
      channelId: status.channelId,
      online: status.online,
      currentSession: status.currentSession ? serializeSession(status.currentSession) : null,
      lastSession: status.lastSession ? serializeSession(status.lastSession) : null,
    };
  }
}

function serializeSession(s: LiveSession) {
  return {
    id: s.getId(),
    channelId: s.getChannelId(),
    platform: s.getPlatform(),
    state: s.getState(),
    title: s.getTitle(),
    startedAt: s.getStartedAt(),
    endedAt: s.getEndedAt(),
    peakViewerCount: s.getPeakViewerCount(),
    totalMessages: s.getTotalMessages(),
    summary: s.getSummary(),
    autoStarted: s.wasAutoStarted(),
    createdAt: s.getCreatedAt(),
  };
}
