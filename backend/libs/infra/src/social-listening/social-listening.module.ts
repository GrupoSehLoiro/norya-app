/**
 * SocialListeningInfraModule — provê adapters de infra do pipeline.
 *
 * Por enquanto só o `RedisCopypastaDedupService` (Fase 2). Próximas
 * fases adicionam aqui: `MongoChannelBrandRepository`,
 * `MongoAdSegmentRepository`, etc.
 */
import { Module, type DynamicModule, Global } from '@nestjs/common';
import { COPYPASTA_DEDUP_TOKEN } from '@sehloro/domain';
import { CacheModule } from '../cache/cache.module';
import { RedisCopypastaDedupService } from './redis-copypasta-dedup.service';

@Global()
@Module({})
export class SocialListeningInfraModule {
  static forRoot(): DynamicModule {
    return {
      module: SocialListeningInfraModule,
      imports: [CacheModule],
      providers: [
        RedisCopypastaDedupService,
        {
          provide: COPYPASTA_DEDUP_TOKEN,
          useExisting: RedisCopypastaDedupService,
        },
      ],
      exports: [COPYPASTA_DEDUP_TOKEN, RedisCopypastaDedupService],
    };
  }
}
