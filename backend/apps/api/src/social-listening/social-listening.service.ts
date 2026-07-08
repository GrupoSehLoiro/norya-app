import { Injectable } from '@nestjs/common';

/**
 * Bounded context: Social Listening.
 *
 * Análise agregada de chat multi-canal (sentimento, trending, amostragem
 * de emojis). Corresponde ao bot `Bot_SocialListening` + rotas
 * `socialListening`/`emoji`/`sentimentConfiguration` do legado.
 */
@Injectable()
export class SocialListeningService {}
