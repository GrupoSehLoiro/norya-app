/**
 * FallbackLlmClassifier — wrapper do `classifyFallback` (domain) que
 * implementa o port `LlmClassifier`. É o que o LlmModule injeta quando
 * o breaker está OPEN ou quando `ai.fallback.forceOnly` está ligado.
 */
import { Injectable } from '@nestjs/common';
import { classifyFallback, type Tier2Output } from '@sehloro/domain';
import type { LlmClassifier, LlmClassifierInput } from './llm-classifier.port';

@Injectable()
export class FallbackLlmClassifier implements LlmClassifier {
  async classify(input: LlmClassifierInput): Promise<Tier2Output> {
    return classifyFallback({
      aggregate: input.aggregate,
      configs: input.configs,
      brandHits: input.brandHits,
      llmTier: 0,
    });
  }
}
