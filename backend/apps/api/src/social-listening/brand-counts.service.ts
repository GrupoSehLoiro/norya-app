/**
 * BrandCountsService — GET /brands/counts
 *
 * Resolve o problema do card "Palavras-chave": em vez de mostrar só o que o
 * pipeline detectou (coluna `mentioned_brands_json`, retroativa-zero e presa
 * ao fechamento do batch), aqui listamos TODAS as palavras cadastradas do
 * canal e contamos as menções varrendo o TEXTO real das mensagens do período
 * (`batch_messages`) na hora da query.
 *
 * Consequências:
 *  - Palavra cadastrada aparece na hora, com contador (0 se ainda não falada).
 *  - A contagem é retroativa: conta o texto já dito, mesmo que a palavra tenha
 *    sido cadastrada depois — sem depender do orchestrator ter a allowlist no
 *    momento em que fechou cada batch.
 *  - Matching normalizado (lower + sem acento) com fronteira de palavra:
 *    "açaí" casa "acai", "REDBULL" casa "redbull". Resolve o case/acento que o
 *    `brand-detector` (usado no pipeline) não cobre.
 */
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BatchMessagesSchemaName } from '@sehloro/infra';
import {
  CHANNEL_BRAND_REPOSITORY,
  CHANNEL_REPOSITORY,
  type ChannelBrandRepository,
  type ChannelRepository,
} from '@sehloro/domain';

export interface BrandCount {
  brand: string;
  count: number;
}

interface PersistedMsg {
  text: string;
}
interface BatchDoc {
  channelId: string;
  windowStart: Date;
  messages: PersistedMsg[];
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class BrandCountsService {
  constructor(
    @Inject(CHANNEL_BRAND_REPOSITORY)
    private readonly brands: ChannelBrandRepository,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    @InjectModel(BatchMessagesSchemaName)
    private readonly model: Model<BatchDoc>,
  ) {}

  async counts(channelId: string, from?: string, to?: string): Promise<BrandCount[]> {
    // A allowlist é do CRIADOR (resolvido pelo canal); a contagem varre as
    // mensagens do canal selecionado (`batch_messages` continua por canal).
    const channel = await this.channels.findById(channelId).catch(() => null);
    const creatorId = channel?.getCreatorId();
    if (!creatorId) return [];
    const brands = await this.brands.listByCreator(creatorId);
    if (brands.length === 0) return [];

    const filter: Record<string, unknown> = { channelId };
    if (from || to) {
      const ws: Record<string, Date> = {};
      if (from) ws.$gte = new Date(from);
      if (to) ws.$lte = new Date(to);
      filter.windowStart = ws;
    }
    const docs = await this.model.find(filter).sort({ windowStart: -1 }).limit(1000).lean().exec();

    // Um matcher por palavra: nome + aliases, normalizados, com fronteira \b.
    // regex custom do admin (se houver) é aplicada crua (sem unaccent) — foi
    // uma escolha explícita de quem cadastrou.
    const matchers = brands.map((b) => {
      if (b.regex && b.regex.trim().length > 0) {
        try {
          return { brand: b.name, re: new RegExp(b.regex, 'gi') };
        } catch {
          return { brand: b.name, re: null as RegExp | null };
        }
      }
      const alts = [b.name, ...(b.aliases ?? [])]
        .map((t) => normalize(t.trim()))
        .filter(Boolean)
        .map(escapeRegex);
      const re = alts.length ? new RegExp(`\\b(${alts.join('|')})\\b`, 'g') : null;
      return { brand: b.name, re };
    });

    // Inicializa todas em 0 pra a palavra cadastrada aparecer mesmo sem menção.
    const acc = new Map<string, number>(brands.map((b) => [b.name, 0]));
    for (const d of docs as unknown as BatchDoc[]) {
      for (const m of d.messages ?? []) {
        const text = normalize(m.text ?? '');
        if (!text) continue;
        for (const mt of matchers) {
          if (!mt.re) continue;
          mt.re.lastIndex = 0;
          const found = text.match(mt.re);
          if (found?.length) acc.set(mt.brand, (acc.get(mt.brand) ?? 0) + found.length);
        }
      }
    }

    return Array.from(acc.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count);
  }
}
