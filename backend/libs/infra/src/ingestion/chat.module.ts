/**
 * ChatModule — providers de ingestão de chat.
 *
 * Expõe ChatProviderFactory para o IngestionModule da API e para o Worker.
 * Os tokens concretos (TWITCH_IRC_PROVIDER_CREATOR, KICK_PUSHER_PROVIDER_CREATOR)
 * são registrados pelos módulos TWI/KCK nos milestones seguintes.
 *
 * Em NODE_ENV=test ou quando nenhum creator concreto é registrado, o factory
 * recorre ao MockChatProvider embutido.
 */
import { Module } from '@nestjs/common';
import { ChatProviderFactory } from './chat-provider.factory';

@Module({
  providers: [ChatProviderFactory],
  exports: [ChatProviderFactory],
})
export class ChatModule {}
