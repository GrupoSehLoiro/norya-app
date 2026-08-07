/**
 * LlmBudgetSettingsService — resolve o teto de custo de IA EFETIVO de um
 * canal e expõe o CRUD que o painel admin usa.
 *
 * Precedência (campo a campo): override do canal → doc global → env
 * (`LLM_BUDGET_TOKENS_MONTHLY`/`LLM_RATE_TOKENS_PER_MINUTE`) → fallback
 * hardcoded. `paused` é OR: global pausado pausa todos.
 *
 * Cache em memória com TTL curto (45s) — mudança do admin vale em <1min sem
 * restart; mutações invalidam na hora na instância local. Fail-open: erro de
 * Mongo → defaults de env (o pipeline nunca para por causa do painel).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  LlmBudgetSettingsSchemaName,
  type LlmBudgetSettingsPersistence,
} from '../persistence/mongoose/schemas/llm-budget-settings.schema';

const CACHE_TTL_MS = 45_000;

/** Últimos defaults (iguais aos do CacheModule) quando nem env existe. */
export const LLM_BUDGET_HARD_DEFAULTS = {
  monthlyTokens: 50_000_000,
  tokensPerMinute: 20_000,
} as const;

export interface EffectiveLlmBudget {
  monthlyTokens: number;
  tokensPerMinute: number;
  paused: boolean;
  /** De onde veio o TETO MENSAL (transparência no painel). */
  source: 'channel' | 'global' | 'env' | 'default';
}

export interface LlmBudgetOverridePatch {
  monthlyTokens?: number;
  tokensPerMinute?: number;
  paused?: boolean;
}

type SettingsFields = Pick<
  LlmBudgetSettingsPersistence,
  'monthlyTokens' | 'tokensPerMinute' | 'paused'
>;

/** Merge puro (testável): channel → global → env → hardcoded. */
export function mergeEffectiveBudget(
  env: { monthlyTokens?: number; tokensPerMinute?: number },
  global: SettingsFields | null,
  channel: SettingsFields | null,
): EffectiveLlmBudget {
  const monthlyTokens =
    channel?.monthlyTokens ??
    global?.monthlyTokens ??
    env.monthlyTokens ??
    LLM_BUDGET_HARD_DEFAULTS.monthlyTokens;
  const tokensPerMinute =
    channel?.tokensPerMinute ??
    global?.tokensPerMinute ??
    env.tokensPerMinute ??
    LLM_BUDGET_HARD_DEFAULTS.tokensPerMinute;
  const source =
    channel?.monthlyTokens != null
      ? ('channel' as const)
      : global?.monthlyTokens != null
        ? ('global' as const)
        : env.monthlyTokens != null
          ? ('env' as const)
          : ('default' as const);
  return {
    monthlyTokens,
    tokensPerMinute,
    // OR: pausa global derruba todos; pausa do canal só ele.
    paused: Boolean(global?.paused) || Boolean(channel?.paused),
    source,
  };
}

@Injectable()
export class LlmBudgetSettingsService {
  private readonly logger = new Logger(LlmBudgetSettingsService.name);
  private cache: {
    at: number;
    global: SettingsFields | null;
    byChannel: Map<string, SettingsFields>;
  } | null = null;

  constructor(
    @InjectModel(LlmBudgetSettingsSchemaName)
    private readonly model: Model<LlmBudgetSettingsPersistence>,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private _envDefaults(): { monthlyTokens?: number; tokensPerMinute?: number } {
    const m = this.config.get<number>('LLM_BUDGET_TOKENS_MONTHLY');
    const t = this.config.get<number>('LLM_RATE_TOKENS_PER_MINUTE');
    return {
      monthlyTokens: m ? Number(m) : undefined,
      tokensPerMinute: t ? Number(t) : undefined,
    };
  }

  private async _load(): Promise<NonNullable<typeof this.cache>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache;
    const docs = await this.model.find().lean().exec();
    const byChannel = new Map<string, SettingsFields>();
    let global: SettingsFields | null = null;
    for (const d of docs) {
      const fields: SettingsFields = {
        monthlyTokens: d.monthlyTokens,
        tokensPerMinute: d.tokensPerMinute,
        paused: Boolean(d.paused),
      };
      if (d.scope === 'global') global = fields;
      else if (d.channelId) byChannel.set(d.channelId, fields);
    }
    this.cache = { at: Date.now(), global, byChannel };
    return this.cache;
  }

  /** Teto efetivo do canal — consumido pelo orchestrator a cada chamada de LLM. */
  async getEffective(channelId: string): Promise<EffectiveLlmBudget> {
    try {
      const { global, byChannel } = await this._load();
      return mergeEffectiveBudget(this._envDefaults(), global, byChannel.get(channelId) ?? null);
    } catch (err) {
      // Fail-open: painel/Mongo nunca derrubam o pipeline.
      this.logger.warn(
        `getEffective falhou (${channelId}): ${(err as Error).message} — env/defaults`,
      );
      return mergeEffectiveBudget(this._envDefaults(), null, null);
    }
  }

  /** Doc global cru (ou null) + defaults de env — o painel mostra a cadeia. */
  async getGlobal(): Promise<{
    global: (SettingsFields & { updatedBy?: string }) | null;
    env: { monthlyTokens?: number; tokensPerMinute?: number };
    hardDefaults: typeof LLM_BUDGET_HARD_DEFAULTS;
  }> {
    const doc = await this.model.findOne({ scope: 'global' }).lean().exec();
    return {
      global: doc
        ? {
            monthlyTokens: doc.monthlyTokens,
            tokensPerMinute: doc.tokensPerMinute,
            paused: Boolean(doc.paused),
            updatedBy: doc.updatedBy,
          }
        : null,
      env: this._envDefaults(),
      hardDefaults: LLM_BUDGET_HARD_DEFAULTS,
    };
  }

  /** Overrides por canal existentes (para o painel montar a tabela). */
  async listChannelOverrides(): Promise<
    Array<{ channelId: string } & SettingsFields & { updatedBy?: string }>
  > {
    const docs = await this.model.find({ scope: 'channel' }).lean().exec();
    return docs
      .filter((d) => d.channelId)
      .map((d) => ({
        channelId: d.channelId!,
        monthlyTokens: d.monthlyTokens,
        tokensPerMinute: d.tokensPerMinute,
        paused: Boolean(d.paused),
        updatedBy: d.updatedBy,
      }));
  }

  /**
   * Upsert do doc global. Semântica de REPLACE dos campos numéricos: campo
   * ausente no patch é removido (volta a herdar de env/default) — o painel
   * sempre envia o estado completo desejado.
   */
  async setGlobal(patch: LlmBudgetOverridePatch, updatedBy?: string): Promise<void> {
    await this._upsert({ scope: 'global' }, patch, updatedBy);
  }

  async setChannel(
    channelId: string,
    patch: LlmBudgetOverridePatch,
    updatedBy?: string,
  ): Promise<void> {
    await this._upsert({ scope: 'channel', channelId }, patch, updatedBy);
  }

  /** Remove o override do canal — volta a herdar do global/env. */
  async deleteChannel(channelId: string): Promise<void> {
    await this.model.deleteOne({ scope: 'channel', channelId }).exec();
    this.invalidate();
  }

  invalidate(): void {
    this.cache = null;
  }

  private async _upsert(
    filter: { scope: 'global' | 'channel'; channelId?: string },
    patch: LlmBudgetOverridePatch,
    updatedBy?: string,
  ): Promise<void> {
    const set: Record<string, unknown> = {
      paused: Boolean(patch.paused),
      ...(updatedBy ? { updatedBy } : {}),
    };
    const unset: Record<string, 1> = {};
    if (patch.monthlyTokens != null) set['monthlyTokens'] = patch.monthlyTokens;
    else unset['monthlyTokens'] = 1;
    if (patch.tokensPerMinute != null) set['tokensPerMinute'] = patch.tokensPerMinute;
    else unset['tokensPerMinute'] = 1;

    await this.model
      .updateOne(
        filter,
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { upsert: true },
      )
      .exec();
    this.invalidate();
  }
}
