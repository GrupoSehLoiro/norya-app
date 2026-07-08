/**
 * AdSummaryController — GET /api/v2/social-listening/ad/summary
 * Visão informativa de anúncios (quantidade, tempo, por hora).
 */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AdSummary, AdSummaryService } from './ad-summary.service';

@Controller('v2/social-listening/ad')
export class AdSummaryController {
  constructor(private readonly service: AdSummaryService) {}

  @Get('summary')
  summary(
    @Query('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AdSummary> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.summary(channelId, from, to);
  }
}
