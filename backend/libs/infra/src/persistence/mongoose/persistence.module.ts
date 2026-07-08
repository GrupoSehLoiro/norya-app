/**
 * PersistenceModule — adapter Mongoose do backend NestJS (NEST-04 + AUTH-02).
 *
 * Responsabilidades:
 *  1. Estabelecer a conexão principal com Mongo (`MongooseModule.forRootAsync`)
 *     lendo `MONGODB_URI` via ConfigService. Essa é a mesma conexão usada
 *     pelos 7 bots legados e pelo SLMOD-api antigo — por isso o database
 *     (`sehloirostudios`) está na própria URI.
 *  2. Registrar os models (`User`, `Channel`) com os nomes legados para
 *     casar com `mongoose.model('User'/'Channel', ...)` dos bots.
 *  3. Registrar o model `RefreshToken` (AUTH-01).
 *  4. Registrar o model `ChannelOAuthToken` (AUTH-02) com o plugin de
 *     encryption-at-rest ligado. O plugin precisa do `CryptoService`, por
 *     isso usamos `MongooseModule.forFeatureAsync` — a factory consegue
 *     injetar deps via DI, o que `forFeature` síncrono não permite.
 *  5. Expor os symbols de repositório do domínio apontando para as
 *     implementações concretas Mongoose.
 *
 * Novos bounded contexts que precisem injetar repositórios só precisam
 * `imports: [PersistenceModule]` no módulo Nest correspondente.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  USER_REPOSITORY,
  CHANNEL_REPOSITORY,
  REFRESH_TOKEN_REPOSITORY,
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  LIVE_SESSION_REPOSITORY,
  WORKSPACE_REPOSITORY,
  MEMBERSHIP_REPOSITORY,
  EMAIL_VERIFICATION_CODE_REPOSITORY,
  CREATOR_REPOSITORY,
  CREATOR_PROFILE_REPOSITORY,
} from '@sehloro/domain';
import { CryptoModule } from '../../crypto/crypto.module';
import { CryptoService } from '../../crypto/crypto.service';
import { createEncryptionPlugin } from '../../crypto/mongoose-encryption.plugin';
import { getEncryptedFields } from '../../crypto/encrypted-field.decorator';
import { UserSchema, UserSchemaName } from './schemas/user.schema';
import { ChannelSchema, ChannelSchemaName } from './schemas/channel.schema';
import { RefreshTokenSchema, RefreshTokenSchemaName } from './schemas/refresh-token.schema';
import {
  ChannelOAuthTokenSchema,
  ChannelOAuthTokenSchemaName,
  ChannelOAuthTokenPersistence,
} from './schemas/channel-oauth-token.schema';
import { UserMongooseRepository } from './repositories/user.mongoose.repository';
import { ChannelMongooseRepository } from './repositories/channel.mongoose.repository';
import { RefreshTokenMongooseRepository } from './repositories/refresh-token.mongoose.repository';
import { ChannelOAuthTokenMongooseRepository } from './repositories/channel-oauth-token.mongoose.repository';
import { WorkerStateSchema, WorkerStateSchemaName } from './schemas/worker-state.schema';
import { LiveSessionSchema, LiveSessionSchemaName } from './schemas/live-session.schema';
import { LiveSessionMongooseRepository } from './repositories/live-session.mongoose.repository';
import { BanSchema, BanSchemaName } from './schemas/ban.schema';
import { TimeoutSchema, TimeoutSchemaName } from './schemas/timeout.schema';
import { MessageDeletedSchema, MessageDeletedSchemaName } from './schemas/message-deleted.schema';
import { PredictionSchema, PredictionSchemaName } from './schemas/prediction.schema';
import { PollSchema, PollSchemaName } from './schemas/poll.schema';
import { ChatEmojiSchema, ChatEmojiSchemaName } from './schemas/chat-emoji.schema';
// Identity / tenant / billing — Fase 1 (sign-up / onboarding)
import { WorkspaceSchema, WorkspaceSchemaName } from './schemas/workspace.schema';
import { MembershipSchema, MembershipSchemaName } from './schemas/membership.schema';
import {
  EmailVerificationCodeSchema,
  EmailVerificationCodeSchemaName,
} from './schemas/email-verification-code.schema';
import { CreatorSchema, CreatorSchemaName } from './schemas/creator.schema';
import { CreatorProfileSchema, CreatorProfileSchemaName } from './schemas/creator-profile.schema';
import { BrandCatalogSchema, BrandCatalogSchemaName } from './schemas/brand-catalog.schema';
import { WorkspaceMongooseRepository } from './repositories/workspace.mongoose.repository';
import { MembershipMongooseRepository } from './repositories/membership.mongoose.repository';
import { EmailVerificationCodeMongooseRepository } from './repositories/email-verification-code.mongoose.repository';
import { CreatorMongooseRepository } from './repositories/creator.mongoose.repository';
import { CreatorProfileMongooseRepository } from './repositories/creator-profile.mongoose.repository';

@Module({
  imports: [
    CryptoModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
        // `serverSelectionTimeoutMS` curto evita que testes e2e sem Mongo
        // fiquem pendurados 30s; em prod Discloud o network é < 100ms, então
        // 5s é folgado. Se necessário, override via env futuro.
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    MongooseModule.forFeature([
      { name: UserSchemaName, schema: UserSchema },
      { name: ChannelSchemaName, schema: ChannelSchema },
      { name: RefreshTokenSchemaName, schema: RefreshTokenSchema },
      { name: WorkerStateSchemaName, schema: WorkerStateSchema },
      { name: LiveSessionSchemaName, schema: LiveSessionSchema },
      // Legacy read-only collections (ver docs/technical/legacy-module.md).
      // Pragmatic: sem ports/adapters. Quando promovidos ao M5 viram DDD.
      { name: BanSchemaName, schema: BanSchema },
      { name: TimeoutSchemaName, schema: TimeoutSchema },
      { name: MessageDeletedSchemaName, schema: MessageDeletedSchema },
      { name: PredictionSchemaName, schema: PredictionSchema },
      { name: PollSchemaName, schema: PollSchema },
      { name: ChatEmojiSchemaName, schema: ChatEmojiSchema },
      // Identity / tenant / billing — Fase 1.
      { name: WorkspaceSchemaName, schema: WorkspaceSchema },
      { name: MembershipSchemaName, schema: MembershipSchema },
      { name: EmailVerificationCodeSchemaName, schema: EmailVerificationCodeSchema },
      { name: CreatorSchemaName, schema: CreatorSchema },
      { name: CreatorProfileSchemaName, schema: CreatorProfileSchema },
      { name: BrandCatalogSchemaName, schema: BrandCatalogSchema },
    ]),
    // Schemas que precisam de plugin com deps do DI vão por forFeatureAsync.
    // A factory recebe `CryptoService` e instala o plugin de encryption-at-rest
    // ANTES de o Mongoose compilar o model — sem isso os hooks nunca seriam
    // registrados e os tokens iriam para o disco em plaintext.
    MongooseModule.forFeatureAsync([
      {
        name: ChannelOAuthTokenSchemaName,
        imports: [CryptoModule],
        inject: [CryptoService],
        useFactory: (crypto: CryptoService) => {
          const schema = ChannelOAuthTokenSchema;
          const fields = getEncryptedFields(ChannelOAuthTokenPersistence);
          schema.plugin(createEncryptionPlugin(crypto), { fields });
          return schema;
        },
      },
    ]),
  ],
  providers: [
    UserMongooseRepository,
    ChannelMongooseRepository,
    RefreshTokenMongooseRepository,
    ChannelOAuthTokenMongooseRepository,
    LiveSessionMongooseRepository,
    WorkspaceMongooseRepository,
    MembershipMongooseRepository,
    EmailVerificationCodeMongooseRepository,
    CreatorMongooseRepository,
    CreatorProfileMongooseRepository,
    {
      provide: USER_REPOSITORY,
      useExisting: UserMongooseRepository,
    },
    {
      provide: CHANNEL_REPOSITORY,
      useExisting: ChannelMongooseRepository,
    },
    {
      provide: REFRESH_TOKEN_REPOSITORY,
      useExisting: RefreshTokenMongooseRepository,
    },
    {
      provide: CHANNEL_OAUTH_TOKEN_REPOSITORY,
      useExisting: ChannelOAuthTokenMongooseRepository,
    },
    {
      provide: LIVE_SESSION_REPOSITORY,
      useExisting: LiveSessionMongooseRepository,
    },
    {
      provide: WORKSPACE_REPOSITORY,
      useExisting: WorkspaceMongooseRepository,
    },
    {
      provide: MEMBERSHIP_REPOSITORY,
      useExisting: MembershipMongooseRepository,
    },
    {
      provide: EMAIL_VERIFICATION_CODE_REPOSITORY,
      useExisting: EmailVerificationCodeMongooseRepository,
    },
    {
      provide: CREATOR_REPOSITORY,
      useExisting: CreatorMongooseRepository,
    },
    {
      provide: CREATOR_PROFILE_REPOSITORY,
      useExisting: CreatorProfileMongooseRepository,
    },
  ],
  exports: [
    USER_REPOSITORY,
    CHANNEL_REPOSITORY,
    REFRESH_TOKEN_REPOSITORY,
    CHANNEL_OAUTH_TOKEN_REPOSITORY,
    LIVE_SESSION_REPOSITORY,
    WORKSPACE_REPOSITORY,
    MEMBERSHIP_REPOSITORY,
    EMAIL_VERIFICATION_CODE_REPOSITORY,
    CREATOR_REPOSITORY,
    CREATOR_PROFILE_REPOSITORY,
    MongooseModule,
  ],
})
export class PersistenceModule {}
