/**
 * Port (DDD) do classificador tier-2. Tem 3 implementações:
 *   - MockLlmClassifier         (default em dev/test)
 *   - RealAnthropicClassifier   (Haiku 4.5 via SDK)
 *   - FallbackKeywordClassifier (usado quando breaker OPEN)
 *
 * O orchestrator injeta via token e o switching mock/real é resolvido
 * no LlmModule.forRootAsync (Fase 5).
 */
import type { BatchAggregate, BrandHit, ClassifierConfigs, Tier2Output } from '@sehloro/domain';

export interface LlmClassifierInput {
  aggregate: BatchAggregate;
  configs: ClassifierConfigs;
  brandHits: BrandHit[];
}

export interface LlmClassifier {
  classify(input: LlmClassifierInput): Promise<Tier2Output>;
}

export const LLM_CLASSIFIER_TOKEN = Symbol('LLM_CLASSIFIER');
