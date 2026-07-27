/**
 * Cliente do CRUD admin de Treinamento IA (/api/v2/admin/ai-training).
 * Tipos espelhados manualmente — a interface HTTP é o contrato.
 */
import { api } from './api-client';

export type AiContextScope = 'global' | 'category' | 'subcategory' | 'item' | 'brand';

export const AI_CONTEXT_PROMPT_MAX = 2000;
export const AI_CONTEXT_PROMPTS_PER_NODE = 10;

export interface AiTrainingContext {
  scope: AiContextScope;
  key: string;
  /** Lista de textos do nó — todos entram na seção do contexto. */
  prompts: string[];
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

export interface AiContextPart {
  scope: AiContextScope;
  key: string;
  /** Posição do texto na lista do nó. */
  index: number;
  chars: number;
  /** false = descartado pelo cap total de tamanho. */
  included: boolean;
}

export interface AiContextPreview {
  channelId: string;
  context: string | null;
  parts: AiContextPart[];
}

export const fetchAiContexts = () =>
  api.get<{ items: AiTrainingContext[] }>('/api/v2/admin/ai-training').then((r) => r.items);

export const upsertAiContext = (dto: {
  scope: AiContextScope;
  key: string;
  prompts: string[];
  enabled: boolean;
}) => api.put<AiTrainingContext>('/api/v2/admin/ai-training', dto);

export const deleteAiContext = (scope: AiContextScope, key: string) =>
  api.delete<{ ok: boolean }>(
    `/api/v2/admin/ai-training?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`,
  );

export const previewAiContext = (channelId: string) =>
  api.get<AiContextPreview>(
    `/api/v2/admin/ai-training/preview?channelId=${encodeURIComponent(channelId)}`,
  );
