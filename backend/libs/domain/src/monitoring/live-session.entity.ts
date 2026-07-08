/**
 * MON-01 · LiveSession — aggregate root do bounded context Monitoring.
 *
 * Representa uma transmissão ao vivo monitorada (manual ou auto-start via EventSub).
 *
 * Invariantes:
 *  - Não pode existir 2 sessões ACTIVE para o mesmo channelId simultaneamente
 *    (enforçado via índice parcial no Mongo e validação no MonitoringService).
 *  - Transições válidas: SCHEDULED → ACTIVE (via start()), ACTIVE → ENDED (via end()).
 *  - endedAt é obrigatório no estado ENDED.
 */
import { DomainError } from '../errors/domain-error';
import { generateId } from '../shared/identity';
import { ChannelPlatform } from '../ingestion/channel.entity';

export type SessionState = 'SCHEDULED' | 'ACTIVE' | 'ENDED';

export class LiveSessionError extends DomainError {
  public readonly code = 'LIVE_SESSION_ERROR';
  public readonly statusCode = 422;
}

export interface LiveSessionPersistenceShape {
  _id: string;
  channelId: string;
  platform: ChannelPlatform;
  state: SessionState;
  title?: string;
  startedAt?: Date;
  endedAt?: Date;
  peakViewerCount?: number;
  avgViewerCount?: number;
  totalMessages: number;
  summary?: string;
  autoStarted: boolean;
  createdAt: Date;
}

// ─── Eventos de domínio ────────────────────────────────────────────────────

export interface LiveSessionStartedEvent {
  type: 'LiveSessionStarted';
  sessionId: string;
  channelId: string;
  startedAt: Date;
  autoStarted: boolean;
}

export interface LiveSessionEndedEvent {
  type: 'LiveSessionEnded';
  sessionId: string;
  channelId: string;
  endedAt: Date;
  totalMessages: number;
  peakViewerCount?: number;
}

export interface LiveSessionPeakEvent {
  type: 'LiveSessionPeak';
  sessionId: string;
  channelId: string;
  viewerCount: number;
  recordedAt: Date;
}

// ─── Entidade ─────────────────────────────────────────────────────────────

export class LiveSession {
  private readonly domainEvents: unknown[] = [];

  private constructor(
    private readonly id: string,
    private readonly channelId: string,
    private readonly platform: ChannelPlatform,
    private state: SessionState,
    private readonly createdAt: Date,
    private readonly autoStarted: boolean,
    private readonly title: string | undefined,
    private startedAt: Date | undefined,
    private endedAt: Date | undefined,
    private peakViewerCount: number | undefined,
    private avgViewerCount: number | undefined,
    private totalMessages: number,
    private summary: string | undefined,
  ) {}

  static create(props: {
    channelId: string;
    platform: ChannelPlatform;
    title?: string;
    autoStarted?: boolean;
  }): LiveSession {
    if (!props.channelId) throw new LiveSessionError('channelId obrigatório');
    const session = new LiveSession(
      generateId(),
      props.channelId,
      props.platform,
      'SCHEDULED',
      new Date(),
      props.autoStarted ?? false,
      props.title,
      undefined,
      undefined,
      undefined,
      undefined,
      0,
      undefined,
    );
    return session;
  }

  static reconstitute(props: LiveSessionPersistenceShape): LiveSession {
    return new LiveSession(
      props._id,
      props.channelId,
      props.platform,
      props.state,
      props.createdAt,
      props.autoStarted,
      props.title,
      props.startedAt,
      props.endedAt,
      props.peakViewerCount,
      props.avgViewerCount,
      props.totalMessages,
      props.summary,
    );
  }

  start(): LiveSessionStartedEvent {
    if (this.state !== 'SCHEDULED') {
      throw new LiveSessionError(`Não é possível iniciar sessão em estado ${this.state}`);
    }
    this.state = 'ACTIVE';
    this.startedAt = new Date();
    const event: LiveSessionStartedEvent = {
      type: 'LiveSessionStarted',
      sessionId: this.id,
      channelId: this.channelId,
      startedAt: this.startedAt,
      autoStarted: this.autoStarted,
    };
    this.domainEvents.push(event);
    return event;
  }

  end(summary?: string): LiveSessionEndedEvent {
    if (this.state !== 'ACTIVE') {
      throw new LiveSessionError(`Não é possível encerrar sessão em estado ${this.state}`);
    }
    this.state = 'ENDED';
    this.endedAt = new Date();
    this.summary = summary;
    const event: LiveSessionEndedEvent = {
      type: 'LiveSessionEnded',
      sessionId: this.id,
      channelId: this.channelId,
      endedAt: this.endedAt,
      totalMessages: this.totalMessages,
      peakViewerCount: this.peakViewerCount,
    };
    this.domainEvents.push(event);
    return event;
  }

  recordViewerCount(count: number): LiveSessionPeakEvent | null {
    if (this.state !== 'ACTIVE') return null;
    if (this.peakViewerCount == null || count > this.peakViewerCount) {
      this.peakViewerCount = count;
      const event: LiveSessionPeakEvent = {
        type: 'LiveSessionPeak',
        sessionId: this.id,
        channelId: this.channelId,
        viewerCount: count,
        recordedAt: new Date(),
      };
      this.domainEvents.push(event);
      return event;
    }
    return null;
  }

  incrementMessages(count = 1): void {
    if (this.state === 'ACTIVE') this.totalMessages += count;
  }

  pullDomainEvents(): unknown[] {
    return this.domainEvents.splice(0);
  }

  getId(): string {
    return this.id;
  }
  getChannelId(): string {
    return this.channelId;
  }
  getPlatform(): ChannelPlatform {
    return this.platform;
  }
  getState(): SessionState {
    return this.state;
  }
  getTitle(): string | undefined {
    return this.title;
  }
  isActive(): boolean {
    return this.state === 'ACTIVE';
  }
  getStartedAt(): Date | undefined {
    return this.startedAt;
  }
  getEndedAt(): Date | undefined {
    return this.endedAt;
  }
  getPeakViewerCount(): number | undefined {
    return this.peakViewerCount;
  }
  getTotalMessages(): number {
    return this.totalMessages;
  }
  getSummary(): string | undefined {
    return this.summary;
  }
  getCreatedAt(): Date {
    return this.createdAt;
  }
  wasAutoStarted(): boolean {
    return this.autoStarted;
  }

  toPersistence(): LiveSessionPersistenceShape {
    return {
      _id: this.id,
      channelId: this.channelId,
      platform: this.platform,
      state: this.state,
      title: this.title,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      peakViewerCount: this.peakViewerCount,
      avgViewerCount: this.avgViewerCount,
      totalMessages: this.totalMessages,
      summary: this.summary,
      autoStarted: this.autoStarted,
      createdAt: this.createdAt,
    };
  }
}
