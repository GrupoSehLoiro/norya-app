import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AD_SEGMENT_REPOSITORY,
  type AdSegment,
  type AdSegmentRepository,
  type AdSegmentSource,
  isAdActiveAt,
  EVENT_BUS_TOKEN,
  type EventBus,
} from '@sehloro/domain';

export const AD_SEGMENT_EVENT_PREFIX = 'social-listening.ad';

@Injectable()
export class AdSegmentService {
  private readonly logger = new Logger(AdSegmentService.name);

  constructor(
    @Inject(AD_SEGMENT_REPOSITORY) private readonly repo: AdSegmentRepository,
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
  ) {}

  async startManual(
    channelId: string,
    durationSec?: number,
    sessionId: string | null = null,
  ): Promise<AdSegment> {
    return this._start({
      channelId,
      sessionId,
      source: 'manual',
      startedAt: new Date(),
      durationSeconds: durationSec ?? null,
      endedAt: durationSec ? new Date(Date.now() + durationSec * 1000) : null,
      isAutomatic: false,
    });
  }

  async startFromTwitch(args: {
    channelId: string;
    sessionId?: string | null;
    startedAt: Date;
    durationSeconds: number;
    isAutomatic: boolean;
    rawPayload?: unknown;
  }): Promise<AdSegment> {
    return this._start({
      channelId: args.channelId,
      sessionId: args.sessionId ?? null,
      source: 'twitch',
      startedAt: args.startedAt,
      durationSeconds: args.durationSeconds,
      endedAt: new Date(args.startedAt.getTime() + args.durationSeconds * 1000),
      isAutomatic: args.isAutomatic,
      rawPayload: args.rawPayload,
    });
  }

  async stop(channelId: string): Promise<AdSegment | null> {
    const closed = await this.repo.closeOpen(channelId, new Date());
    if (closed) {
      this.logger.log(`ad-stop channel=${channelId} segment=${closed.id}`);
      await this.bus.publish(`${AD_SEGMENT_EVENT_PREFIX}.stop`, closed);
    }
    return closed;
  }

  /**
   * Returns o status atual { active, source } no momento `at` (default now).
   * Considera segments com endedAt no futuro (twitch trouxe duration upfront)
   * ou endedAt=null (manual em curso).
   */
  async getStatus(
    channelId: string,
    at: Date = new Date(),
  ): Promise<{ active: boolean; source: AdSegmentSource | null; segment: AdSegment | null }> {
    const open = await this.repo.findOpen(channelId);
    if (open && isAdActiveAt(open, at)) {
      return { active: true, source: open.source, segment: open };
    }
    // Pode haver segmentos `closed` (endedAt no futuro) ativos ainda
    const overlap = await this.repo.findOverlapping(channelId, at, at);
    const hit = overlap.find((s) => isAdActiveAt(s, at));
    if (hit) {
      return { active: true, source: hit.source, segment: hit };
    }
    return { active: false, source: null, segment: null };
  }

  /** Para uso do orchestrator: AD ativa em algum momento do intervalo. */
  async getAdActiveInWindow(
    channelId: string,
    from: Date,
    to: Date,
  ): Promise<{ active: boolean; source: AdSegmentSource | null }> {
    const segs = await this.repo.findOverlapping(channelId, from, to);
    if (segs.length === 0) return { active: false, source: null };
    // Preferir 'twitch' sobre 'manual' se ambos
    const twitch = segs.find((s) => s.source === 'twitch');
    return { active: true, source: twitch?.source ?? segs[0]!.source };
  }

  private async _start(input: Parameters<AdSegmentRepository['create']>[0]): Promise<AdSegment> {
    // Fecha qualquer aberto anterior para esse canal (evita overlap).
    await this.repo.closeOpen(input.channelId, input.startedAt);
    const seg = await this.repo.create(input);
    this.logger.log(
      `ad-start channel=${seg.channelId} source=${seg.source} duration=${seg.durationSeconds ?? '?'}`,
    );
    await this.bus.publish(`${AD_SEGMENT_EVENT_PREFIX}.start`, seg);
    return seg;
  }
}
