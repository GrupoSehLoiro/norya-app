import { LiveSession } from './live-session.entity';

export interface LiveSessionRepository {
  findById(id: string): Promise<LiveSession | null>;
  findActiveByChannel(channelId: string): Promise<LiveSession | null>;
  findMany(filters: {
    channelId?: string;
    state?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }): Promise<{ sessions: LiveSession[]; total: number }>;
  save(session: LiveSession): Promise<LiveSession>;
  delete(id: string): Promise<void>;
  /**
   * Sessões ACTIVE consideradas paradas: o último evento (lastEventAt) — ou,
   * na falta dele, o startedAt — é anterior ao threshold passado.
   * Usado pelo cron de stale-closer (MON-04).
   */
  findStaleActive(threshold: Date): Promise<LiveSession[]>;
}

export const LIVE_SESSION_REPOSITORY = Symbol('LiveSessionRepository');
