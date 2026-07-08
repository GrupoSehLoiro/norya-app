import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeatureFlagSchema, FeatureFlagSchemaName } from '@sehloro/infra';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsSeedService } from './feature-flags.seed';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: FeatureFlagSchemaName, schema: FeatureFlagSchema }]),
  ],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureFlagsSeedService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
