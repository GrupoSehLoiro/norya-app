/**
 * BrandDetector — função pura que conta menções de cada marca da
 * allowlist do canal num batch de msgs. Custo zero (regex local).
 *
 * Saída: top-N por count desc, com sample de msgIds (até 3) para
 * preview no dashboard.
 */
import type { RawMessage } from '../ingestion/raw-message';
import type { ChannelBrand } from './channel-brand.entity';

export interface BrandHit {
  brand: string;
  count: number;
  sample: string[]; // msgIds
}

interface CompiledBrand {
  name: string;
  regex: RegExp;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(brand: ChannelBrand): CompiledBrand | null {
  // Override explícito do admin
  if (brand.regex && brand.regex.trim().length > 0) {
    try {
      return { name: brand.name, regex: new RegExp(brand.regex, 'gi') };
    } catch {
      return null; // regex inválida → ignora silenciosamente
    }
  }
  // Derivado de name + aliases
  const alts = [brand.name, ...brand.aliases].map(escapeRegex).filter(Boolean);
  if (alts.length === 0) return null;
  return { name: brand.name, regex: new RegExp(`\\b(${alts.join('|')})\\b`, 'gi') };
}

export function detectBrands(
  msgs: ReadonlyArray<RawMessage>,
  brands: ReadonlyArray<ChannelBrand>,
  opts?: { sampleSize?: number },
): BrandHit[] {
  if (brands.length === 0 || msgs.length === 0) return [];
  const sampleSize = opts?.sampleSize ?? 3;
  const compiled = brands.map(compile).filter((b): b is CompiledBrand => b !== null);
  if (compiled.length === 0) return [];

  const acc = new Map<string, { count: number; sample: string[] }>();
  for (const m of msgs) {
    for (const c of compiled) {
      // reset lastIndex pra cada msg porque /g é stateful
      c.regex.lastIndex = 0;
      const matches = m.text.match(c.regex);
      if (!matches || matches.length === 0) continue;
      let bucket = acc.get(c.name);
      if (!bucket) {
        bucket = { count: 0, sample: [] };
        acc.set(c.name, bucket);
      }
      bucket.count += matches.length;
      if (bucket.sample.length < sampleSize) {
        bucket.sample.push(m.id);
      }
    }
  }

  return Array.from(acc.entries())
    .map(([brand, v]) => ({ brand, count: v.count, sample: v.sample }))
    .sort((a, b) => b.count - a.count);
}
