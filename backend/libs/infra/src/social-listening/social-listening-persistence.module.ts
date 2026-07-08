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
import { AdSegmentMongooseRepository } from '../persistence/mongoose/repositories/ad-segment.mongoose.repository';
import { ChannelBrandMongooseRepository } from '../persistence/mongoose/repositories/channel-brand.mongoose.repository';
import { BatchMessagesMongooseRepository } from '../persistence/mongoose/repositories/batch-messages.mongoose.repository';
import { ConfigsLoaderService } from './configs-loader.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdSegmentSchemaName, schema: AdSegmentSchema },
      { name: ChannelBrandSchemaName, schema: ChannelBrandSchema },
      { name: SentimentConfigurationSchemaName, schema: SentimentConfigurationSchema },
      { name: CategoryConfigurationSchemaName, schema: CategoryConfigurationSchema },
      { name: BatchMessagesSchemaName, schema: BatchMessagesSchema },
    ]),
  ],
  providers: [
    AdSegmentMongooseRepository,
    ChannelBrandMongooseRepository,
    BatchMessagesMongooseRepository,
    ConfigsLoaderService,
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
    MongooseModule, // re-exporta forFeature dos schemas SentimentConfig/CategoryConfig
  ],
})
export class SocialListeningPersistenceModule {}
