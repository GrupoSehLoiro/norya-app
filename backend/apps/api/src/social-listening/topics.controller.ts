/**
 * TopicsController — GET /api/v2/social-listening/insights/topics
 * "Assuntos do chat": labels + descrição via IA (Haiku) por período.
 */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ChatTopics, TopicBucket, TopicsService } from './topics.service';

@Controller('v2/social-listening/insights')
export class TopicsController {
  constructor(private readonly service: TopicsService) {}

  @Get('topics')
  topics(
    @Query('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ChatTopics> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.topics(channelId, from, to);
  }

  @Get('topics/history')
  history(
    @Query('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<TopicBucket[]> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.history(channelId, from, to);
  }
}
