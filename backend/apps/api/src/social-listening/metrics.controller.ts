import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { MetricsService, type Granularity } from './metrics.service';

@Controller('v2/social-listening/metrics')
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Get('summary')
  async summary(
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('granularity') granularityStr?: string,
    @Query('channelId') channelId?: string,
  ) {
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      throw new BadRequestException('from inválido');
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new BadRequestException('to inválido');
    }
    let granularity: Granularity | undefined;
    if (granularityStr) {
      if (granularityStr !== 'minute' && granularityStr !== 'hour' && granularityStr !== 'day') {
        throw new BadRequestException('granularity inválida (use minute|hour|day)');
      }
      granularity = granularityStr;
    }
    return this.service.summary({ from, to, granularity, channelId });
  }
}
