/**
 * AiTrainingService — CRUD do catálogo global de contextos de IA.
 *
 * Chaves de scopes taxonômicos são validadas contra a taxonomia fixa do
 * onboarding (previne typo silencioso que nunca daria match com perfil
 * nenhum); marcas são texto livre lowercase.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AiContextResolverService,
  AiTrainingContextSchemaName,
  type AiContextScope,
  type AiTrainingContextPersistence,
  type ResolvedAiContext,
} from '@sehloro/infra';
import { CATEGORIES } from '../creator/taxonomy';

export interface AiTrainingContextView {
  scope: AiContextScope;
  key: string;
  prompts: string[];
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

export interface UpsertContextInput {
  scope: AiContextScope;
  key: string;
  prompts: string[];
  enabled: boolean;
}

@Injectable()
export class AiTrainingService {
  /** Conjuntos de chaves válidas por scope, derivados da taxonomia fixa. */
  private readonly validKeys: Record<'category' | 'subcategory' | 'item', Set<string>>;

  constructor(
    @InjectModel(AiTrainingContextSchemaName)
    private readonly model: Model<AiTrainingContextPersistence>,
    private readonly resolver: AiContextResolverService,
  ) {
    const category = new Set<string>();
    const subcategory = new Set<string>();
    const item = new Set<string>();
    for (const cat of CATEGORIES) {
      if (cat.value !== 'other') category.add(cat.value);
      for (const sub of cat.subcategories) {
        if (sub.value !== 'other') subcategory.add(sub.value);
        for (const it of sub.items ?? []) {
          if (it.value !== 'other') item.add(`${sub.value}/${it.value}`);
        }
      }
    }
    this.validKeys = { category, subcategory, item };
  }

  async list(): Promise<AiTrainingContextView[]> {
    const docs = await this.model.find().sort({ scope: 1, key: 1 }).lean().exec();
    return docs.map((d) => ({
      scope: d.scope,
      key: d.key,
      prompts: d.prompts ?? [],
      enabled: d.enabled ?? true,
      updatedBy: d.updatedBy ?? '',
      updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : null,
    }));
  }

  async upsert(input: UpsertContextInput, updatedBy: string): Promise<AiTrainingContextView> {
    const key = this._normalizeKey(input.scope, input.key);
    const prompts = input.prompts.map((p) => p.trim()).filter(Boolean);
    if (prompts.length === 0) {
      throw new BadRequestException('pelo menos um texto é obrigatório');
    }
    const doc = await this.model
      .findOneAndUpdate(
        { scope: input.scope, key },
        { $set: { prompts, enabled: input.enabled, updatedBy } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
    this.resolver.invalidateAll();
    return {
      scope: doc!.scope,
      key: doc!.key,
      prompts: doc!.prompts ?? [],
      enabled: doc!.enabled ?? true,
      updatedBy: doc!.updatedBy ?? '',
      updatedAt: doc!.updatedAt ? new Date(doc!.updatedAt).toISOString() : null,
    };
  }

  async remove(scope: AiContextScope, key: string): Promise<void> {
    await this.model.deleteOne({ scope, key: this._normalizeKey(scope, key) }).exec();
    this.resolver.invalidateAll();
  }

  async preview(channelId: string): Promise<ResolvedAiContext> {
    // Preview sempre fresco — o admin acabou de editar e quer ver o efeito.
    this.resolver.invalidateAll();
    return this.resolver.resolveDetailed(channelId);
  }

  private _normalizeKey(scope: AiContextScope, raw: string): string {
    const key = scope === 'brand' ? raw.trim().toLowerCase() : raw.trim();
    if (scope === 'global') return '';
    if (!key) throw new BadRequestException(`key obrigatória para scope "${scope}"`);
    if (scope !== 'brand' && !this.validKeys[scope].has(key)) {
      throw new BadRequestException(`key "${key}" não existe na taxonomia para scope "${scope}"`);
    }
    return key;
  }
}
