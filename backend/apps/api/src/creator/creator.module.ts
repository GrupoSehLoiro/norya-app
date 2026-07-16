/**
 * CreatorModule — agregado de produto (Creator + CreatorProfile) + onboarding.
 *
 * Importa PersistenceModule (repos) e IdentityModule (EntitlementsService +
 * guards de RBAC já globais). Controllers escopam tudo ao workspace ativo.
 */
import { Module } from '@nestjs/common';
import { PersistenceModule } from '@sehloro/infra';
import { IdentityModule } from '../identity/identity.module';
import { ChannelLinkBackfill } from './channel-link.backfill';
import { CreatorController } from './creator.controller';
import { CreatorService } from './creator.service';
import { IntegrationsController } from './integrations.controller';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { BrandCatalogController } from './brand-catalog.controller';
import { BrandCatalogService } from './brand-catalog.service';

@Module({
  imports: [PersistenceModule, IdentityModule],
  controllers: [
    CreatorController,
    IntegrationsController,
    OnboardingController,
    BrandCatalogController,
  ],
  providers: [CreatorService, OnboardingService, BrandCatalogService, ChannelLinkBackfill],
  exports: [CreatorService, OnboardingService],
})
export class CreatorModule {}
