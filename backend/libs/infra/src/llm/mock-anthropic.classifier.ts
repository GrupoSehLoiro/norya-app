/**
 * MockLlmClassifier — implementação default sem chamar Anthropic.
 *
 * Comportamento determinístico: encaminha pra `classifyFallback` mas
 * reporta tier=2 + modelo "mock-haiku-4-5" + latência simulada. Útil
 * para dev local sem API key, CI offline e testes do orchestrator/SSE.
 */
import { Injectable } from '@nestjs/common';
import { classifyFallback, type Tier2Output } from '@sehloro/domain';
import type { LlmClassifier, LlmClassifierInput } from './llm-classifier.port';

const MOCK_MODEL = 'mock-haiku-4-5';
const SIM_LATENCY_MS = 12;

@Injectable()
export class MockLlmClassifier implements LlmClassifier {
  async classify(input: LlmClassifierInput): Promise<Tier2Output> {
    // Reaproveita o fallback que já calcula os 7 insights via heurística.
    const out = classifyFallback({
      aggregate: input.aggregate,
      configs: input.configs,
      brandHits: input.brandHits,
      llmTier: 0, // não vai ser usado — substituído abaixo
    });

    // Reportar como se fosse Haiku (mas custo zero) → telemetria
    // distingue mock de real pelo model name.
    return {
      ...out,
      llmTier: 2,
      llmModel: MOCK_MODEL,
      llmCostUsd: 0,
      llmLatencyMs: SIM_LATENCY_MS,
      llmCacheHitRate: 0,
      reasoning: 'mock (heurística + delay simulado)',
      dominantCategoryContext: out.topCategories[0]
        ? `Pauta "${out.topCategories[0].category}" concentra a conversa da janela (contexto simulado).`
        : '',
    };
  }
}
