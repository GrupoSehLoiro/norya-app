/**
 * BrandAnalyticsController — GET /api/v2/social-listening/brands/analytics
 * Totais de menção por marca + timeline diária (a partir de batch_analysis).
 */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { BrandAnalytics, BrandAnalyticsService } from './brand-analytics.service';

@Controller('v2/social-listening/brands')
export class BrandAnalyticsController {
  constructor(private readonly service: BrandAnalyticsService) {}

  @Get('analytics')
  analytics(
    @Query('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<BrandAnalytics> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.analytics(channelId, from, to);
  }
}
