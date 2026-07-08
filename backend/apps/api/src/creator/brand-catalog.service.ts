/**
 * BrandCatalogService — catálogo global de marcas para a busca do onboarding.
 *
 * - Seeda no boot (idempotente, upsert por slug) a partir de BRAND_CATALOG_SEED.
 * - `search(q)`: busca por nome/alias (case-insensitive), priorizando prefixo.
 *
 * Padrão pragmático (como o legacy): Mongoose model injetado direto, sem
 * port/adapter DDD — é dado de referência, não agregado de negócio.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { slugify } from '@sehloro/domain';
import { BrandCatalogPersistence, BrandCatalogSchemaName } from '@sehloro/infra';
import { BRAND_CATALOG_SEED } from './brand-catalog.seed';

export interface BrandCatalogItem {
  slug: string;
  name: string;
  aliases: string[];
  sector: string;
  country: string;
}

@Injectable()
export class BrandCatalogService implements OnModuleInit {
  private readonly logger = new Logger(BrandCatalogService.name);

  constructor(
    @InjectModel(BrandCatalogSchemaName)
    private readonly model: Model<BrandCatalogPersistence>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seed();
    } catch (err) {
      // Não derruba o boot se o seed falhar (ex.: Mongo indisponível em teste).
      this.logger.warn(`seed do catálogo de marcas falhou: ${(err as Error).message}`);
    }
  }

  /** Upsert idempotente por slug — roda a cada boot, barato (~200 docs). */
  async seed(): Promise<void> {
    const ops = BRAND_CATALOG_SEED.map((b) => {
      const slug = slugify(b.name);
      return {
        updateOne: {
          filter: { _id: slug },
          update: {
            $set: {
              name: b.name,
              aliases: b.aliases ?? [],
              sector: b.sector,
              country: b.country,
            },
            $setOnInsert: { _id: slug },
          },
          upsert: true,
        },
      };
    });
    if (ops.length > 0) {
      await this.model.bulkWrite(ops, { ordered: false });
    }
    this.logger.log(`catálogo de marcas seedado (${ops.length} marcas)`);
  }

  /**
   * Busca marcas por nome/alias. `q` vazio → top por país BR primeiro.
   * Prioriza match por prefixo do nome; limita o resultado.
   */
  async search(q: string, limit = 12): Promise<BrandCatalogItem[]> {
    const term = (q ?? '').trim();
    const cap = Math.min(50, Math.max(1, limit));

    if (term.length === 0) {
      const docs = await this.model.find({}).sort({ country: 1, name: 1 }).limit(cap).lean().exec();
      return docs.map((d) => this.toItem(d));
    }

    // Match ancorado em início de palavra (\b) — evita falso-positivo de
    // substring no meio de palavra (ex.: "red" casando "p[red]ator"/Acer).
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('\\b' + esc, 'i');
    const docs = await this.model
      .find({ $or: [{ name: rx }, { aliases: rx }] })
      .limit(cap * 2)
      .lean()
      .exec();

    const prefix = new RegExp('^' + esc, 'i');
    const ranked = docs
      .map((d) => ({ d, score: prefix.test(d.name) ? 0 : 1 }))
      .sort((a, b) => a.score - b.score || a.d.name.localeCompare(b.d.name))
      .slice(0, cap)
      .map((x) => this.toItem(x.d));
    return ranked;
  }

  private toItem(d: {
    _id: string;
    name: string;
    aliases?: string[];
    sector?: string;
    country?: string;
  }): BrandCatalogItem {
    return {
      slug: String(d._id),
      name: d.name,
      aliases: d.aliases ?? [],
      sector: d.sector ?? '',
      country: d.country ?? 'global',
    };
  }
}
