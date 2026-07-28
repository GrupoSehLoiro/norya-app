/**
 * IdentityModule.
 *
 * Agora consome o `USER_REPOSITORY` + `REFRESH_TOKEN_REPOSITORY` via
 * PersistenceModule e expõe:
 *   - AuthController (login/refresh/logout).
 *   - JwtStrategy (Passport).
 *   - JwtAuthGuard registrado como `APP_GUARD` global — todas as rotas
 *     exigem auth por default; rotas marcadas com `@Public()` bypassam.
 *
 * O JwtModule é configurado async para pegar `JWT_SECRET` e `JWT_ACCESS_TTL`
 * do ConfigService. Define-se um `expiresIn` default aqui; o AuthService
 * sobrescreve no `sign()` para deixar explícito (e para evitar que tokens
 * emitidos por partes descuidadas do código saiam sem expiração).
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import {
  AdSegmentSchema,
  AdSegmentSchemaName,
  BatchMessagesSchema,
  BatchMessagesSchemaName,
  ChannelBrandSchema,
  ChannelBrandSchemaName,
  CryptoModule,
  EmailModule,
  PersistenceModule,
  TwitchEventSubSubscriptionSchema,
  TwitchEventSubSubscriptionSchemaName,
} from '@sehloro/infra';
import type { AppConfig } from '../config/config.schema';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { PasswordHasher } from './auth/password-hasher';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { WorkspaceRoleGuard } from './auth/guards/workspace-role.guard';
import { EntitlementsService } from './billing/entitlements.service';
import { EntitlementsController } from './billing/entitlements.controller';
import { KickOAuthService } from '@sehloro/infra';
import { AdminUsersController } from './admin-users/admin-users.controller';
import { AdminUsersService } from './admin-users/admin-users.service';
import { AdminUsersBootstrap } from './admin-users/admin-users.bootstrap';
import { UserCascadeService } from './admin-users/user-cascade.service';

@Module({
  imports: [
    CryptoModule,
    EmailModule.forRootAsync(),
    PersistenceModule,
    // Models que o UserCascadeService usa e que o PersistenceModule não
    // registra (vivem no social-listening-persistence / worker). Registrar de
    // novo aqui é seguro: mesmo nome + mesma connection ⇒ mesmo model.
    MongooseModule.forFeature([
      { name: AdSegmentSchemaName, schema: AdSegmentSchema },
      { name: BatchMessagesSchemaName, schema: BatchMessagesSchema },
      { name: ChannelBrandSchemaName, schema: ChannelBrandSchema },
      { name: TwitchEventSubSubscriptionSchemaName, schema: TwitchEventSubSubscriptionSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }),
        },
      }),
    }),
  ],
  // KickOAuthController vive no KickOAuthModule (precisa do CreatorModule,
  // que importa este módulo — declará-lo aqui criaria ciclo).
  controllers: [IdentityController, AuthController, EntitlementsController, AdminUsersController],
  providers: [
    IdentityService,
    AuthService,
    AdminUsersService,
    UserCascadeService,
    AdminUsersBootstrap,
    EntitlementsService,
    PasswordHasher,
    JwtStrategy,
    KickOAuthService,
    // Guard global de autenticação — ver comentário no topo do arquivo.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Guard global de RBAC por workspace — no-op em rotas sem @RequireWsRole.
    // Registrado APÓS o JwtAuthGuard (que popula req.user).
    {
      provide: APP_GUARD,
      useClass: WorkspaceRoleGuard,
    },
  ],
  exports: [IdentityService, AuthService, EntitlementsService, KickOAuthService],
})
export class IdentityModule {}
