/**
 * BatchInsightController — GET /api/v2/social-listening/batches/:batchId/insight
 * Insight por IA (Haiku) de um bloco do feed ao vivo.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { BatchInsight, BatchInsightService } from './batch-insight.service';

@Controller('v2/social-listening/batches')
export class BatchInsightController {
  constructor(private readonly service: BatchInsightService) {}

  @Get(':batchId/insight')
  insight(@Param('batchId') batchId: string): Promise<BatchInsight> {
    return this.service.forBatch(batchId);
  }
}
