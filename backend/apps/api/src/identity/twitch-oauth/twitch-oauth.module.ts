/**
 * TwitchOAuthModule — wire do controller + service.
 *
 * Depende de:
 *  - PersistenceModule (CHANNEL_REPOSITORY + CHANNEL_OAUTH_TOKEN_REPOSITORY)
 *  - TwitchConduitApiModule (TwitchConduitService + TwitchConduitSubscriptionsService)
 *    → ao fim do callback OAuth, o controller chama subscribeChannel pra
 *      ativar `channel.chat.message` via conduit no Twitch.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PersistenceModule, TwitchOAuthService } from '@sehloro/infra';
import { TwitchConduitApiModule } from '../../ingestion/twitch-conduit/twitch-conduit-api.module';
import { TwitchOAuthController } from './twitch-oauth.controller';

@Module({
  imports: [
    PersistenceModule,
    TwitchConduitApiModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [TwitchOAuthController],
  providers: [TwitchOAuthService],
  exports: [TwitchOAuthService],
})
export class TwitchOAuthModule {}
