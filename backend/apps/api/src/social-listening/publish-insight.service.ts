import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_BUS_TOKEN, type EventBus } from '@sehloro/domain';
import type { BatchAnalysis } from './batch-analysis.types';

export const INSIGHT_CHANNEL_PREFIX = 'analysis:';

@Injectable()
export class PublishInsightService {
  private readonly logger = new Logger(PublishInsightService.name);

  constructor(@Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus) {}

  async publish(b: BatchAnalysis): Promise<void> {
    try {
      await this.bus.publish(INSIGHT_CHANNEL_PREFIX + b.channelId, b);
      await this.bus.publish(INSIGHT_CHANNEL_PREFIX + 'all', b);
    } catch (err) {
      this.logger.error(`Falha ao publicar insight: ${(err as Error).message}`);
    }
  }
}
