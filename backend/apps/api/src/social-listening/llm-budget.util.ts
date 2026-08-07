/**
 * Estimativa de custo (em tokens) de UMA chamada do classificador tier-2,
 * usada para debitar o budget do canal no LlmRateLimiterService ANTES da
 * chamada — a API só informa o custo real depois, e o débito precisa ser
 * pré-pago para o teto funcionar como freio.
 *
 * Modelo da estimativa (conservador, ~4 chars/token pt-BR):
 *  - aggregate serializado: input não-cacheado integral;
 *  - aiContext: input não-cacheado integral também. Uma versão anterior
 *    contava esse bloco a 10% assumindo cache read, mas o prefixo do
 *    classificador não atinge o mínimo cacheável do modelo tier-2 e o cache
 *    nunca chega a ser criado — ver PROMPT_CACHE_MIN_TOKENS em
 *    prompt-templates.ts. Cobrar 10% subestimava o consumo em ~1k tokens por
 *    chamada e furava o teto;
 *  - prefixo fixo (tools + system, ~2,2k tokens): embutido no OUTPUT_ALLOWANCE;
 *  - saída: teto de 600 tokens do classificador (max_tokens).
 *
 * Precisão exata não importa aqui: o budget é freio de catástrofe, não
 * contabilidade — o custo REAL por chamada continua vindo do `usage` da API
 * e gravado em `llmCostUsd` no ClickHouse. Mas errar PRA MENOS quebra o
 * freio, então a estimativa erra sempre pra cima.
 */
import type { BatchAggregate } from '@sehloro/domain';
import { serializeAggregate } from '@sehloro/infra';

const CHARS_PER_TOKEN = 4;
/**
 * Teto de saída do classificador (600) + prefixo fixo tools+system, que é
 * enviado a preço cheio em toda chamada (~2,2k tokens medidos via
 * count_tokens contra o Haiku 4.5).
 */
export const LLM_OUTPUT_TOKEN_ALLOWANCE = 2800;

export function estimateClassifyTokens(agg: BatchAggregate, aiContext?: string): number {
  const inputChars = serializeAggregate(agg).length + (aiContext?.length ?? 0);
  return Math.ceil(inputChars / CHARS_PER_TOKEN) + LLM_OUTPUT_TOKEN_ALLOWANCE;
}
