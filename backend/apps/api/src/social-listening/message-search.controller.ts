/**
 * MessageSearchController — GET /api/v2/social-listening/messages/search
 * Busca mensagens do chat por termo/data. Qualquer usuário autenticado.
 */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { MessageSearchResult, MessageSearchService } from './message-search.service';

@Controller('v2/social-listening/messages')
export class MessageSearchController {
  constructor(private readonly service: MessageSearchService) {}

  @Get('search')
  search(
    @Query('channelId') channelId: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<MessageSearchResult> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.search({
      channelId,
      q,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
