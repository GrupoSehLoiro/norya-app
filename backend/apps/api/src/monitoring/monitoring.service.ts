/**
 * MON-02 · MonitoringService.
 *
 * Casos de uso do bounded context Monitoring:
 *  - `startSession({channelId, title?, autoStarted?, source?})` — abre uma
 *    nova LiveSession ACTIVE. Idempotente: se já existe ACTIVE para o canal,
 *    devolve a existente (com log explicando) em vez de quebrar.
 *  - `endSession(sessionId)` / `endActiveByChannel(channelId, summary?)` —
 *    fecha. Idempotente também: já-ENDED é no-op.
 *  - `findSession`, `findMany` — passthrough para o repositório.
 *
 * Publica eventos de domínio no event bus depois de persistir, para que
 * o pipeline IA (M4) e o painel SSE (VIZ-01) reajam.
 *
 * Auth: a validação de ownership (ownerId vs userId/admin) fica no controller.
 * Aqui o service confia que o caller é autorizado — mantém o domínio agnóstico
 * de quem está chamando.
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { REDIS_TOKEN } from '@sehloro/infra';
import {
  CHANNEL_REPOSITORY,
  Channel,
  ChannelRepository,
  EVENT_BUS_TOKEN,
  EventBus,
  LIVE_SESSION_REPOSITORY,
  LiveSession,
  LiveSessionRepository,
} from '@sehloro/domain';

// Canal do event bus onde MonitoringService publica os eventos de domínio
// (LiveSessionStarted/Ended). Exportado para o MonitoringStreamController
// assinar e repassar via SSE em tempo real ao console.
export const DOMAIN_EVENT_CHANNEL = 'monitoring.live-session';

export interface StartSessionInput {
  channelId: string;
  title?: string;
  autoStarted?: boolean;
  /** Origem livre — 'manual', 'twitch.eventsub'. Apenas para log. */
  source?: string;
}

export interface ListSessionsFilters {
  channelId?: string;
  state?: 'SCHEDULED' | 'ACTIVE' | 'ENDED';
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @Inject(LIVE_SESSION_REPOSITORY)
    private readonly sessions: LiveSessionRepository,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    @Inject(EVENT_BUS_TOKEN)
    private readonly bus: EventBus,
    // Heartbeat de atividade escrito pelo orchestrator (sl:live:<channelId>).
    // Permite reportar "online" por ATIVIDADE quando a live já estava no ar
    // antes de qualquer evento stream.online. Null sem Redis.
    @Optional()
    @Inject(REDIS_TOKEN)
    private readonly redis: { get: (key: string) => Promise<string | null> } | null,
  ) {}

  async startSession(input: StartSessionInput): Promise<LiveSession> {
    const channel = await this._loadChannel(input.channelId);

    const existing = await this.sessions.findActiveByChannel(input.channelId);
    if (existing) {
      this.logger.log(
        `LiveSession ACTIVE ${existing.getId()} já existe para canal ${input.channelId} ` +
          `(source=${input.source ?? 'unspecified'}, autoStarted=${input.autoStarted ?? false}) — retornando existente`,
      );
      return existing;
    }

    const session = LiveSession.create({
      channelId: input.channelId,
      platform: channel.getPlatform(),
      title: input.title,
      autoStarted: input.autoStarted ?? false,
    });

    const startEvent = session.start();
    const saved = await this.sessions.save(session);

    this.logger.log(
      `LiveSession ${saved.getId()} iniciada (canal=${input.channelId}, ` +
        `autoStarted=${saved.wasAutoStarted()}, source=${input.source ?? 'unspecified'})`,
    );
    await this._publishDomainEvent(startEvent);
    return saved;
  }

  async endSession(sessionId: string, summary?: string): Promise<LiveSession> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new NotFoundException(`Sessão ${sessionId} não encontrada`);

    if (!session.isActive()) {
      this.logger.log(`endSession no-op para ${sessionId}: estado atual ${session.getState()}`);
      return session;
    }

    const endEvent = session.end(summary);
    const saved = await this.sessions.save(session);

    this.logger.log(
      `LiveSession ${sessionId} encerrada (totalMessages=${saved.getTotalMessages()})`,
    );
    await this._publishDomainEvent(endEvent);
    return saved;
  }

  async endActiveByChannel(channelId: string, summary?: string): Promise<LiveSession | null> {
    const active = await this.sessions.findActiveByChannel(channelId);
    if (!active) return null;
    return this.endSession(active.getId(), summary);
  }

  async findById(id: string): Promise<LiveSession> {
    const session = await this.sessions.findById(id);
    if (!session) throw new NotFoundException(`Sessão ${id} não encontrada`);
    return session;
  }

  async findActiveByChannel(channelId: string): Promise<LiveSession | null> {
    return this.sessions.findActiveByChannel(channelId);
  }

  /**
   * Status conciso pro console mostrar "ONLINE/OFFLINE" + última sessão.
   *  - `online: true` quando existe LiveSession ACTIVE (o handler
   *    stream.online do bridge cria isso quando Twitch emite o evento).
   *  - `online: false` quando a sessão mais recente já foi encerrada
   *    (stream.offline ou o stale-closer fechou por timeout).
   */
  async getChannelStatus(channelId: string): Promise<{
    channelId: string;
    online: boolean;
    currentSession: LiveSession | null;
    lastSession: LiveSession | null;
  }> {
    const active = await this.sessions.findActiveByChannel(channelId);
    if (active) {
      return { channelId, online: true, currentSession: active, lastSession: null };
    }
    // Sem sessão ACTIVE: cai pro heartbeat de atividade do orchestrator —
    // cobre o caso de a live já estar no ar (sem evento stream.online) mas
    // com chat/análise chegando.
    let liveByActivity = false;
    try {
      liveByActivity = Boolean(await this.redis?.get(`sl:live:${channelId}`));
    } catch {
      /* best-effort */
    }
    const recent = await this.sessions.findMany({
      channelId,
      pageSize: 1,
      page: 1,
    });
    return {
      channelId,
      online: liveByActivity,
      currentSession: null,
      lastSession: recent.sessions[0] ?? null,
    };
  }

  async findMany(
    filters: ListSessionsFilters,
  ): Promise<{ sessions: LiveSession[]; total: number }> {
    return this.sessions.findMany(filters);
  }

  /**
   * Helper para o controller: valida que o canal existe e pertence ao caller.
   * Retorna o Channel para que o controller decida se aceita ou propaga 403.
   */
  async assertChannelOwner(channelId: string, userId: string, role: string): Promise<Channel> {
    const channel = await this._loadChannel(channelId);
    if (role === 'admin') return channel;
    const owner = channel.getOwnerId();
    if (!owner || owner !== userId) {
      throw new NotFoundException(`Canal ${channelId} não encontrado ou não pertence ao usuário`);
    }
    return channel;
  }

  /**
   * Cria a sessão e dispara `ConflictException` se já existir ACTIVE — contraste
   * com `startSession` que é idempotente. Usado pelo POST manual via HTTP.
   */
  async startSessionStrict(input: StartSessionInput): Promise<LiveSession> {
    const existing = await this.sessions.findActiveByChannel(input.channelId);
    if (existing) {
      throw new ConflictException(
        `Canal ${input.channelId} já tem sessão ACTIVE (${existing.getId()})`,
      );
    }
    return this.startSession(input);
  }

  // ─── internos ────────────────────────────────────────────────────────────

  private async _loadChannel(channelId: string): Promise<Channel> {
    const channel = await this.channels.findById(channelId);
    if (!channel) throw new NotFoundException(`Canal ${channelId} não encontrado`);
    return channel;
  }

  private async _publishDomainEvent(event: unknown): Promise<void> {
    try {
      await this.bus.publish(DOMAIN_EVENT_CHANNEL, event);
    } catch (err) {
      // Falha de publish não derruba o caso de uso — só registra.
      this.logger.error('Falha ao publicar evento de monitoring no bus', err);
    }
  }
}
