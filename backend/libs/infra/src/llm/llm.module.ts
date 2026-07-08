/**
 * LlmModule — provê `LlmClassifier` selecionando mock vs real via env.
 *
 *   LLM_DRIVER=mock (default) → MockLlmClassifier
 *   LLM_DRIVER=real           → RealAnthropicClassifier (ANTHROPIC_API_KEY exigido)
 *   LLM_DRIVER=fallback       → FallbackLlmClassifier (heurística pura)
 *
 * Sempre disponível via Inject(LLM_CLASSIFIER_TOKEN). FallbackLlmClassifier
 * também é exportado nominalmente para o orchestrator usar em
 * downgrade dinâmico (breaker OPEN no real).
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LLM_CLASSIFIER_TOKEN } from './llm-classifier.port';
import { MockLlmClassifier } from './mock-anthropic.classifier';
import { FallbackLlmClassifier } from './fallback-llm.classifier';
import { RealAnthropicClassifier } from './real-anthropic.classifier';

@Global()
@Module({})
export class LlmModule {
  static forRootAsync(): DynamicModule {
    return {
      module: LlmModule,
      imports: [ConfigModule],
      providers: [
        MockLlmClassifier,
        FallbackLlmClassifier,
        RealAnthropicClassifier,
        {
          provide: LLM_CLASSIFIER_TOKEN,
          inject: [
            ConfigService,
            MockLlmClassifier,
            FallbackLlmClassifier,
            RealAnthropicClassifier,
          ],
          useFactory: (
            config: ConfigService,
            mock: MockLlmClassifier,
            fallback: FallbackLlmClassifier,
            real: RealAnthropicClassifier,
          ) => {
            const driver = config.get<string>('LLM_DRIVER') ?? 'mock';
            switch (driver) {
              case 'real':
                return real;
              case 'fallback':
                return fallback;
              case 'mock':
              default:
                return mock;
            }
          },
        },
      ],
      exports: [
        LLM_CLASSIFIER_TOKEN,
        MockLlmClassifier,
        FallbackLlmClassifier,
        RealAnthropicClassifier,
      ],
    };
  }
}
