/**
 * KickOAuthModule — wire do controller (paridade com TwitchOAuthModule).
 *
 * Extraído do IdentityModule para poder importar o CreatorModule sem ciclo
 * (CreatorModule → IdentityModule): ao fim do callback OAuth o controller
 * chama CreatorService.autoLinkIntegration pra vincular o canal ao creator
 * do workspace ativo. O KickOAuthService continua provido/exportado pelo
 * IdentityModule (outros consumidores o pegam de lá).
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PersistenceModule } from '@sehloro/infra';
import { IdentityModule } from '../identity.module';
import { CreatorModule } from '../../creator/creator.module';
import { KickOAuthController } from './kick-oauth.controller';

@Module({
  imports: [
    PersistenceModule,
    IdentityModule,
    CreatorModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [KickOAuthController],
})
export class KickOAuthModule {}
