/**
 * EmotesController — GET /api/v2/social-listening/emotes?channelId=
 * Dicionário code→imagem (Twitch + BTTV + 7TV) pro frontend renderizar
 * emotes nas mensagens do chat. Qualquer usuário autenticado.
 */
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ChannelEmotesResult, EmotesService } from './emotes.service';

@Controller('v2/social-listening/emotes')
export class EmotesController {
  constructor(private readonly service: EmotesService) {}

  @Get()
  list(@Query('channelId') channelId: string): Promise<ChannelEmotesResult> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.forChannel(channelId);
  }
}
