/**
 * AiContextResolverService — monta o bloco de "Treinamento IA" de um canal.
 *
 * Cadeia: channelId → Channel.creatorId → CreatorProfile (category/subcategory/
 * tags no vocabulário da taxonomia) + marcas do canal (channel_brands) →
 * busca os prompts do catálogo global `ai_training_contexts` e compõe um
 * único texto, do geral para o específico (global → categoria → subcategoria
 * → itens → marcas) — o mais específico vem depois e refina o geral.
 *
 * Mesmo padrão do ConfigsLoaderService: vive em @sehloro/infra, cache curto
 * em memória (por canal), fail-open (erro → sem contexto, nunca derruba a
 * análise). `invalidateAll()` é chamado pelas mutações do CRUD admin.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CHANNEL_REPOSITORY,
  CREATOR_PROFILE_REPOSITORY,
  type ChannelRepository,
  type CreatorProfileRepository,
} from '@sehloro/domain';
import {
  AiTrainingContextSchemaName,
  type AiContextScope,
  type AiTrainingContextPersistence,
} from '../persistence/mongoose/schemas/ai-training-context.schema';
import { ChannelBrandMongooseRepository } from '../persistence/mongoose/repositories/channel-brand.mongoose.repository';

const CACHE_TTL_MS = 60_000;
/** Cap TOTAL do bloco montado — prompts que não cabem são descartados inteiros. */
const TOTAL_CAP_CHARS = 4000;

const HEADER =
  'Contexto do canal (curadoria da plataforma):\n' +
  'As diretrizes abaixo dão contexto sobre o canal/nicho analisado. ' +
  'Elas COMPLEMENTAM as instruções principais, não as substituem.';

const SCOPE_LABEL: Record<AiContextScope, string> = {
  global: 'Geral',
  category: 'Categoria',
  subcategory: 'Subcategoria',
  item: 'Item',
  brand: 'Marca',
};

export interface AiContextPart {
  scope: AiContextScope;
  key: string;
  /** Posição do texto na lista do nó (0-based) — um nó pode ter vários. */
  index: number;
  chars: number;
  /** false quando o texto foi descartado pelo cap total. */
  included: boolean;
}

export interface ResolvedAiContext {
  text: string | null;
  parts: AiContextPart[];
}

@Injectable()
export class AiContextResolverService {
  private readonly logger = new Logger(AiContextResolverService.name);
  private readonly cache = new Map<string, { at: number; resolved: ResolvedAiContext }>();

  constructor(
    @InjectModel(AiTrainingContextSchemaName)
    private readonly contextModel: Model<AiTrainingContextPersistence>,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Inject(CREATOR_PROFILE_REPOSITORY) private readonly profiles: CreatorProfileRepository,
    private readonly brands: ChannelBrandMongooseRepository,
  ) {}

  /** Atalho: só o texto final (o que as chamadas de IA anexam). */
  async resolveForChannel(channelId: string): Promise<string | null> {
    return (await this.resolveDetailed(channelId)).text;
  }

  /** Versão detalhada — o preview admin mostra as partes (inclusive cortadas). */
  async resolveDetailed(channelId: string): Promise<ResolvedAiContext> {
    const hit = this.cache.get(channelId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.resolved;

    try {
      const resolved = await this._resolve(channelId);
      this.cache.set(channelId, { at: Date.now(), resolved });
      return resolved;
    } catch (err) {
      this.logger.warn(
        `Falha ao resolver contexto de IA do canal ${channelId}: ${(err as Error).message} — seguindo sem contexto`,
      );
      return { text: null, parts: [] };
    }
  }

  /** Limpa o cache (mutações do CRUD admin / testes). */
  invalidateAll(): void {
    this.cache.clear();
  }

  private async _resolve(channelId: string): Promise<ResolvedAiContext> {
    // Vocabulário do canal: taxonomia do perfil + marcas do allowlist.
    const categoryKeys: string[] = [];
    const subcategoryKeys: string[] = [];
    const itemKeys: string[] = [];

    const channel = await this.channels.findById(channelId).catch(() => null);
    const creatorId = channel?.getCreatorId();
    let brandDocs: Awaited<ReturnType<typeof this.brands.listByCreator>> = [];
    if (creatorId) {
      brandDocs = await this.brands.listByCreator(creatorId).catch(() => []);
      const profile = await this.profiles.findByCreatorId(creatorId).catch(() => null);
      if (profile) {
        const p = profile.toPersistence();
        if (p.category && p.category !== 'other') categoryKeys.push(p.category);
        const subs = new Set<string>();
        if (p.subcategory && p.subcategory !== 'other') subs.add(p.subcategory);
        for (const tag of p.tags ?? []) {
          if (!tag || tag === 'other') continue;
          if (tag.includes('/')) {
            if (!tag.endsWith('/other')) itemKeys.push(tag);
          } else {
            subs.add(tag);
          }
        }
        subcategoryKeys.push(...subs);
      }
    }

    const brandKeys = [...new Set(brandDocs.map((b) => b.name.toLowerCase()))];

    const or: Record<string, unknown>[] = [{ scope: 'global' }];
    if (categoryKeys.length) or.push({ scope: 'category', key: { $in: categoryKeys } });
    if (subcategoryKeys.length) or.push({ scope: 'subcategory', key: { $in: subcategoryKeys } });
    if (itemKeys.length) or.push({ scope: 'item', key: { $in: itemKeys } });
    if (brandKeys.length) or.push({ scope: 'brand', key: { $in: brandKeys } });

    const docs = await this.contextModel.find({ enabled: true, $or: or }).lean().exec();
    if (docs.length === 0) return { text: null, parts: [] };

    // Ordena geral → específico; dentro do mesmo scope, por key (determinístico).
    const order: AiContextScope[] = ['global', 'category', 'subcategory', 'item', 'brand'];
    docs.sort(
      (a, b) => order.indexOf(a.scope) - order.indexOf(b.scope) || a.key.localeCompare(b.key),
    );

    const parts: AiContextPart[] = [];
    const sections: string[] = [];
    let used = HEADER.length;
    let capped = false;
    for (const d of docs) {
      const title = d.scope === 'global' ? `## ${SCOPE_LABEL.global}` : `## ${SCOPE_LABEL[d.scope]}: ${d.key}`;
      const texts = (d.prompts ?? []).map((t) => t.trim()).filter(Boolean);
      // Cada TEXTO é uma unidade: descartamos textos inteiros quando não cabem
      // (instrução cortada no meio confunde o modelo); como a ordem é
      // geral→específico, sob pressão caem primeiro itens/marcas — a base
      // curada permanece. Ao primeiro estouro, tudo depois cai junto
      // (previsível para o admin, visível no preview).
      const kept: string[] = [];
      texts.forEach((text, index) => {
        const titleCost = kept.length === 0 ? title.length + 1 : 0;
        const cost = titleCost + text.length + 3; // "- " + quebra
        if (capped || used + cost > TOTAL_CAP_CHARS) {
          capped = true;
          parts.push({ scope: d.scope, key: d.key, index, chars: text.length, included: false });
          return;
        }
        used += cost;
        kept.push(text);
        parts.push({ scope: d.scope, key: d.key, index, chars: text.length, included: true });
      });
      if (kept.length === 1) {
        sections.push(`${title}\n${kept[0]}`);
      } else if (kept.length > 1) {
        sections.push(`${title}\n${kept.map((t) => `- ${t}`).join('\n')}`);
      }
    }

    if (capped) {
      this.logger.warn(
        `Contexto de IA do canal ${channelId} passou de ${TOTAL_CAP_CHARS} chars — ` +
          `${parts.filter((p) => !p.included).length} prompt(s) descartado(s)`,
      );
    }
    if (sections.length === 0) return { text: null, parts };

    return { text: `${HEADER}\n\n${sections.join('\n\n')}`, parts };
  }
}
