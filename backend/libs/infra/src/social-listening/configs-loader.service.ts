/**
 * ConfigsLoaderService — lê listas legadas do Mongo:
 *   - SentimentConfiguration: name in ('positive','negative','neutral','blockedWords','blockedPerson','botUsers')
 *   - CategoryConfig:         name = <categoria>, keywords = palavras
 *
 * Cache simples (1 minuto) para evitar query por tick/mensagem.
 *
 * Vive em @sehloro/infra (e não no app da API) porque tanto o orchestrator
 * da API quanto o ChatIngestService do worker precisam das mesmas configs
 * para o tier-1 — duplicar o loader criaria drift entre os dois processos.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { type ClassifierConfigs, emptyConfigs } from '@sehloro/domain';
import {
  SentimentConfigurationSchemaName,
  type SentimentConfigurationPersistence,
} from '../persistence/mongoose/schemas/sentiment-configuration.schema';
import {
  CategoryConfigurationSchemaName,
  type CategoryConfigurationPersistence,
} from '../persistence/mongoose/schemas/category-configuration.schema';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class ConfigsLoaderService {
  private readonly logger = new Logger(ConfigsLoaderService.name);
  private cached: { at: number; configs: ClassifierConfigs } | null = null;

  constructor(
    @InjectModel(SentimentConfigurationSchemaName)
    private readonly sentimentModel: Model<SentimentConfigurationPersistence>,
    @InjectModel(CategoryConfigurationSchemaName)
    private readonly categoryModel: Model<CategoryConfigurationPersistence>,
  ) {}

  async load(): Promise<ClassifierConfigs> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.configs;
    }

    const cfg = emptyConfigs();
    try {
      const [sentimentDocs, categoryDocs] = await Promise.all([
        this.sentimentModel.find().lean().exec(),
        this.categoryModel.find().lean().exec(),
      ]);

      const sentiment = {
        positive: new Set<string>(),
        negative: new Set<string>(),
        neutral: new Set<string>(),
      };
      const blockedWords = new Set<string>();
      const blockedUsers = new Set<string>();
      const botUsers = new Set<string>();

      for (const d of sentimentDocs) {
        const key = d.name?.toLowerCase();
        const kws = (d.keywords ?? []).map((k) => k.toLowerCase());
        if (!key) continue;
        if (key === 'positive') kws.forEach((k) => sentiment.positive.add(k));
        else if (key === 'negative') kws.forEach((k) => sentiment.negative.add(k));
        else if (key === 'neutral') kws.forEach((k) => sentiment.neutral.add(k));
        else if (key === 'blockedwords') kws.forEach((k) => blockedWords.add(k));
        else if (key === 'blockedperson') kws.forEach((k) => blockedUsers.add(k));
        else if (key === 'botusers') kws.forEach((k) => botUsers.add(k));
      }

      const categories = new Map<string, Set<string>>();
      for (const d of categoryDocs) {
        const kws = new Set((d.keywords ?? []).map((k) => k.toLowerCase()));
        categories.set(d.name, kws);
      }

      const composed: ClassifierConfigs = {
        sentiment,
        categories,
        blockedWords,
        blockedUsers,
        botUsers,
      };
      this.cached = { at: Date.now(), configs: composed };
      return composed;
    } catch (err) {
      this.logger.warn(`Falha ao carregar configs: ${(err as Error).message} — usando vazio`);
      return cfg;
    }
  }

  /** Limpa cache (para tests / após mutação admin). */
  invalidate(): void {
    this.cached = null;
  }
}
