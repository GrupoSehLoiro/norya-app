import type { AdSegment, AdSegmentSource } from './ad-segment.entity';

export interface AdSegmentRepository {
  create(input: {
    channelId: string;
    sessionId: string | null;
    source: AdSegmentSource;
    startedAt: Date;
    endedAt?: Date | null;
    durationSeconds?: number | null;
    isAutomatic?: boolean;
    rawPayload?: unknown;
  }): Promise<AdSegment>;

  /** Atualiza endedAt e duração do segmento aberto mais recente do canal. */
  closeOpen(channelId: string, endedAt: Date): Promise<AdSegment | null>;

  /** Segmento aberto mais recente do canal, se houver. */
  findOpen(channelId: string): Promise<AdSegment | null>;

  /** Lista segments do canal que tocam o intervalo [from, to]. */
  findOverlapping(channelId: string, from: Date, to: Date): Promise<AdSegment[]>;
}

export const AD_SEGMENT_REPOSITORY = Symbol('AD_SEGMENT_REPOSITORY');
