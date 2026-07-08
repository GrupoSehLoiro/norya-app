/**
 * LegacyModule — agrega 6 endpoints read-only sobre collections que os bots
 * legados ainda escrevem (bans, timeouts, mensagens removidas, predictions,
 * polls, emojis).
 *
 * Arquitetura: **pragmática** (Mongoose model injetado direto no service),
 * intencionalmente fora do padrão DDD ports+adapters usado pelos contextos
 * "vivos" (channels, live-session). Ver docs/technical/legacy-module.md
 * para o critério de promoção a DDD completa (quando absorvido por M5,
 * features migram para o bounded context apropriado).
 *
 * Todas as rotas vivem sob `/api/v2/legacy/*` e exigem JWT (guard global).
 */
import { Module } from '@nestjs/common';
import { CacheModule, PersistenceModule } from '@sehloro/infra';
import { BansController } from './bans/bans.controller';
import { BansService } from './bans/bans.service';
import { TimeoutsController } from './timeouts/timeouts.controller';
import { TimeoutsService } from './timeouts/timeouts.service';
import { RemovedMessagesController } from './removed/removed.controller';
import { RemovedMessagesService } from './removed/removed.service';
import { PredictionsController } from './predictions/predictions.controller';
import { PredictionsService } from './predictions/predictions.service';
import { PollsController } from './polls/polls.controller';
import { PollsService } from './polls/polls.service';
import { EmojisController } from './emojis/emojis.controller';
import { EmojisService } from './emojis/emojis.service';
import { BanHandler } from './event-handlers/ban.handler';
import { MessageDeleteHandler } from './event-handlers/message-delete.handler';
import { PollHandler } from './event-handlers/poll.handler';
import { PredictionHandler } from './event-handlers/prediction.handler';
import { ChatEmojiHandler } from './event-handlers/chat-emoji.handler';

@Module({
  imports: [PersistenceModule, CacheModule],
  controllers: [
    BansController,
    TimeoutsController,
    RemovedMessagesController,
    PredictionsController,
    PollsController,
    EmojisController,
  ],
  providers: [
    BansService,
    TimeoutsService,
    RemovedMessagesService,
    PredictionsService,
    PollsService,
    EmojisService,
    // Event-handlers que ligam o conduit às collections legadas (Fase 5).
    BanHandler,
    MessageDeleteHandler,
    PollHandler,
    PredictionHandler,
    ChatEmojiHandler,
  ],
})
export class LegacyModule {}
