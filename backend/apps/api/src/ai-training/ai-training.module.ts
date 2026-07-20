/**
 * Treinamento IA — CRUD admin do catálogo global de contextos/prompts
 * (ai_training_contexts) + preview do contexto resolvido por canal.
 */
import { Module } from '@nestjs/common';
import { SocialListeningPersistenceModule } from '@sehloro/infra';
import { AiTrainingController } from './ai-training.controller';
import { AiTrainingService } from './ai-training.service';

@Module({
  // O persistence module traz o model AiTrainingContext (via MongooseModule
  // re-exportado) e o AiContextResolverService.
  imports: [SocialListeningPersistenceModule],
  controllers: [AiTrainingController],
  providers: [AiTrainingService],
})
export class AiTrainingModule {}
