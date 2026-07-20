/**
 * Treinamento IA — Mongoose schema dos contextos de curadoria.
 *
 * Catálogo GLOBAL (sem tenant): um prompt por nó da taxonomia do onboarding
 * (categoria → subcategoria → item/game), por marca, ou global. As chaves
 * seguem o MESMO vocabulário que o CreatorProfile grava:
 *   scope 'global'      → key ''
 *   scope 'category'    → key 'games'            (CategoryNode.value)
 *   scope 'subcategory' → key 'fps'              (SubcategoryNode.value / tag sem '/')
 *   scope 'item'        → key 'fps/valorant'     (formato dos tags "subcat/item")
 *   scope 'brand'       → key 'coca-cola'        (nome da marca, lowercase)
 *
 * O AiContextResolverService monta o bloco final por canal e injeta nas
 * chamadas de IA (classificador tier-2 + relatórios/insights).
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export const AiTrainingContextSchemaName = 'AiTrainingContext';

export const AI_CONTEXT_SCOPES = ['global', 'category', 'subcategory', 'item', 'brand'] as const;
export type AiContextScope = (typeof AI_CONTEXT_SCOPES)[number];

/** Limite por texto — o resolver ainda aplica um cap TOTAL na montagem. */
export const AI_CONTEXT_PROMPT_MAX = 2000;
/** Máximo de textos por nó. */
export const AI_CONTEXT_PROMPTS_PER_NODE = 10;

@Schema({
  collection: 'ai_training_contexts',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class AiTrainingContextPersistence {
  @Prop({ type: String, required: true, enum: AI_CONTEXT_SCOPES })
  scope!: AiContextScope;

  @Prop({ type: String, required: true, default: '' })
  key!: string;

  /** Lista de textos do nó — todos entram na seção do contexto. */
  @Prop({ type: [String], required: true, default: [] })
  prompts!: string[];

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  /** Username/e-mail do admin que fez a última edição (auditoria leve). */
  @Prop({ type: String, default: '' })
  updatedBy!: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export type AiTrainingContextDocument = HydratedDocument<AiTrainingContextPersistence>;
export const AiTrainingContextSchema = SchemaFactory.createForClass(AiTrainingContextPersistence);
AiTrainingContextSchema.index({ scope: 1, key: 1 }, { unique: true });
