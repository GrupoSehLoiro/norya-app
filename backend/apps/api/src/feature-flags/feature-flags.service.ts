/**
 * FF-01 · FeatureFlagsService.
 *
 * Avalia feature flags com targeting por canal, user ou percentual.
 * Cache em memória de 30 s por (key+ctx) para evitar round-trip ao Mongo.
 *
 * Avaliação de rules: primeira rule que bater vence (order matters).
 * Percentage: hash estável de targetId → bucket em [0,100); determinístico.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { FeatureFlagPersistence, FeatureFlagSchemaName, FlagRule } from '@sehloro/infra';

export interface FlagContext {
  channelId?: string;
  userId?: string;
}

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectModel(FeatureFlagSchemaName)
    private readonly model: Model<FeatureFlagPersistence>,
  ) {}

  async isEnabled(key: string, ctx: FlagContext = {}): Promise<boolean> {
    const cacheKey = `${key}:${ctx.channelId ?? ''}:${ctx.userId ?? ''}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const doc = await this.model.findOne({ key }).lean().exec();
    if (!doc) {
      this.logger.warn(`Flag "${key}" não encontrada — retornando false`);
      return false;
    }

    const value = this._evaluate(doc.defaultValue, doc.rules ?? [], ctx);
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async bulk(keys: string[], ctx: FlagContext = {}): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    await Promise.all(
      keys.map(async (k) => {
        result[k] = await this.isEnabled(k, ctx);
      }),
    );
    return result;
  }

  async findAll(): Promise<FeatureFlagPersistence[]> {
    return this.model.find().sort({ key: 1 }).lean().exec();
  }

  async upsert(
    key: string,
    patch: Partial<Pick<FeatureFlagPersistence, 'defaultValue' | 'rules' | 'description'>>,
    updatedBy?: string,
  ): Promise<FeatureFlagPersistence> {
    const doc = await this.model
      .findOneAndUpdate(
        { key },
        { $set: { ...patch, updatedBy } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    this._invalidateCache(key);
    return doc!;
  }

  async findByKey(key: string): Promise<FeatureFlagPersistence> {
    const doc = await this.model.findOne({ key }).lean().exec();
    if (!doc) throw new NotFoundException(`Flag "${key}" não encontrada`);
    return doc;
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  private _evaluate(defaultValue: boolean, rules: FlagRule[], ctx: FlagContext): boolean {
    for (const rule of rules) {
      const match = this._matchRule(rule, ctx);
      if (match !== null) return match;
    }
    return defaultValue;
  }

  private _matchRule(rule: FlagRule, ctx: FlagContext): boolean | null {
    switch (rule.type) {
      case 'channel':
        if (ctx.channelId && rule.ids?.includes(ctx.channelId)) return rule.value;
        return null;
      case 'user':
        if (ctx.userId && rule.ids?.includes(ctx.userId)) return rule.value;
        return null;
      case 'percentage': {
        const targetId = ctx.channelId ?? ctx.userId;
        if (!targetId || rule.percentage == null) return null;
        const bucket = this._hashBucket(targetId);
        return bucket < rule.percentage ? rule.value : null;
      }
      default:
        return null;
    }
  }

  /** Hash estável: sha256(id) → int[0,100) */
  private _hashBucket(id: string): number {
    const hex = createHash('sha256').update(id).digest('hex').slice(0, 8);
    return parseInt(hex, 16) % 100;
  }

  private _invalidateCache(key: string): void {
    for (const cacheKey of this.cache.keys()) {
      if (cacheKey.startsWith(`${key}:`)) this.cache.delete(cacheKey);
    }
  }
}
