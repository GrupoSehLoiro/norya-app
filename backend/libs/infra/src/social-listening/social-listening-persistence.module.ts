/**
 * SocialListeningPersistenceModule — registra os schemas Mongoose
 * de M4 Fase 3 (ad_segments + channel_brands) e expõe os ports
 * de repositório.
 *
 * Mantemos separado do PersistenceModule principal para não
 * impactar testes existentes; ambos compartilham a mesma conexão
 * Mongo (forRootAsync já feito pelo PersistenceModule).
 */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AD_SEGMENT_REPOSITORY, CHANNEL_BRAND_REPOSITORY } from '@sehloro/domain';
import {
  AdSegmentSchema,
  AdSegmentSchemaName,
} from '../persistence/mongoose/schemas/ad-segment.schema';
import {
  ChannelBrandSchema,
  ChannelBrandSchemaName,
} from '../persistence/mongoose/schemas/channel-brand.schema';
import {
  SentimentConfigurationSchema,
  SentimentConfigurationSchemaName,
} from '../persistence/mongoose/schemas/sentiment-configuration.schema';
import {
  CategoryConfigurationSchema,
  CategoryConfigurationSchemaName,
} from '../persistence/mongoose/schemas/category-configuration.schema';
import {
  BatchMessagesSchema,
  BatchMessagesSchemaName,
} from '../persistence/mongoose/schemas/batch-messages.schema';
import {
  AiTrainingContextSchema,
  AiTrainingContextSchemaName,
} from '../persistence/mongoose/schemas/ai-training-context.schema';
import {
  LlmBudgetSettingsSchema,
  LlmBudgetSettingsSchemaName,
} from '../persistence/mongoose/schemas/llm-budget-settings.schema';
import { AdSegmentMongooseRepository } from '../persistence/mongoose/repositories/ad-segment.mongoose.repository';
import { ChannelBrandMongooseRepository } from '../persistence/mongoose/repositories/channel-brand.mongoose.repository';
import { BatchMessagesMongooseRepository } from '../persistence/mongoose/repositories/batch-messages.mongoose.repository';
import { PersistenceModule } from '../persistence/mongoose/persistence.module';
import { ConfigsLoaderService } from './configs-loader.service';
import { AiContextResolverService } from './ai-context-resolver.service';
import { LlmBudgetSettingsService } from './llm-budget-settings.service';

@Module({
  imports: [
    // Ports de Channel/CreatorProfile para o AiContextResolver (canal →
    // creator → perfil). Sem ciclo: o PersistenceModule não importa este.
    PersistenceModule,
    MongooseModule.forFeature([
      { name: AdSegmentSchemaName, schema: AdSegmentSchema },
      { name: ChannelBrandSchemaName, schema: ChannelBrandSchema },
      { name: SentimentConfigurationSchemaName, schema: SentimentConfigurationSchema },
      { name: CategoryConfigurationSchemaName, schema: CategoryConfigurationSchema },
      { name: BatchMessagesSchemaName, schema: BatchMessagesSchema },
      { name: AiTrainingContextSchemaName, schema: AiTrainingContextSchema },
      { name: LlmBudgetSettingsSchemaName, schema: LlmBudgetSettingsSchema },
    ]),
  ],
  providers: [
    AdSegmentMongooseRepository,
    ChannelBrandMongooseRepository,
    BatchMessagesMongooseRepository,
    ConfigsLoaderService,
    AiContextResolverService,
    LlmBudgetSettingsService,
    { provide: AD_SEGMENT_REPOSITORY, useExisting: AdSegmentMongooseRepository },
    { provide: CHANNEL_BRAND_REPOSITORY, useExisting: ChannelBrandMongooseRepository },
  ],
  exports: [
    AD_SEGMENT_REPOSITORY,
    CHANNEL_BRAND_REPOSITORY,
    AdSegmentMongooseRepository,
    ChannelBrandMongooseRepository,
    BatchMessagesMongooseRepository,
    ConfigsLoaderService,
    AiContextResolverService,
    LlmBudgetSettingsService,
    MongooseModule, // re-exporta forFeature dos schemas SentimentConfig/CategoryConfig
  ],
})
export class SocialListeningPersistenceModule {}
