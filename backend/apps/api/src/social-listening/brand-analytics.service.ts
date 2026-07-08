/**
 * BrandAnalyticsService — agrega menções de marca a partir de `batch_analysis`
 * (coluna `mentioned_brands_json`, já produzida pelo pipeline por janela).
 * Devolve total por marca + timeline por dia. Valida só contra ClickHouse real.
 *
 * NB: sentimento POR marca e orgânico-vs-mod NÃO saem daqui (não estão no
 * batch_analysis) — ver docs/technical/auth-onboarding/04-possiveis-llm.md.
 */
import { Injectable } from '@nestjs/common';
import { ClickHouseClient } from '@sehloro/infra';

export interface BrandMentionTotal {
  brand: string;
  count: number;
}
export interface BrandTimelinePoint {
  day: string;
  brand: string;
  count: number;
}
export interface BrandAnalytics {
  channelId: string;
  totals: BrandMentionTotal[];
  timeline: BrandTimelinePoint[];
}

interface Row {
  created_at?: string;
  mentioned_brands_json?: string;
  day?: string;
}

@Injectable()
export class BrandAnalyticsService {
  constructor(private readonly ch: ClickHouseClient) {}

  async analytics(channelId: string, from?: string, to?: string): Promise<BrandAnalytics> {
    const params = { channelId, from: from ?? '', to: to ?? '' };
    const rows = await this.ch.query<Row>(
      `SELECT toString(toDate(created_at)) AS day, mentioned_brands_json
       FROM batch_analysis
       WHERE channel_id = {channelId:String}
         AND ({from:String} = '' OR created_at >= parseDateTimeBestEffortOrNull({from:String}))
         AND ({to:String} = '' OR created_at <= parseDateTimeBestEffortOrNull({to:String}))
         AND mentioned_brands_json != '' AND mentioned_brands_json != '[]'`,
      params,
    );

    const totals = new Map<string, number>();
    const timeline = new Map<string, number>(); // key = day|brand
    for (const r of rows) {
      let arr: Array<{ brand: string; count: number }> = [];
      try {
        arr = JSON.parse(r.mentioned_brands_json ?? '[]');
      } catch {
        continue;
      }
      for (const m of arr) {
        if (!m?.brand) continue;
        totals.set(m.brand, (totals.get(m.brand) ?? 0) + (m.count ?? 0));
        const k = `${r.day}|${m.brand}`;
        timeline.set(k, (timeline.get(k) ?? 0) + (m.count ?? 0));
      }
    }

    return {
      channelId,
      totals: Array.from(totals.entries())
        .map(([brand, count]) => ({ brand, count }))
        .sort((a, b) => b.count - a.count),
      timeline: Array.from(timeline.entries())
        .map(([k, count]) => {
          const [day, brand] = k.split('|');
          return { day: day!, brand: brand!, count };
        })
        .sort((a, b) => a.day.localeCompare(b.day)),
    };
  }
}
