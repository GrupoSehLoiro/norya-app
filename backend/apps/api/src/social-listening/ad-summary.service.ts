/**
 * AdSummaryService — visão informativa de anúncios (não toggle): quantidade,
 * tempo total/médio e distribuição por hora, a partir de `ad_segments`
 * (ClickHouse). Valida só contra ClickHouse real.
 */
import { Injectable } from '@nestjs/common';
import { ClickHouseClient } from '@sehloro/infra';

export interface AdHourBucket {
  bucket: string;
  ads: number;
  seconds: number;
}

export interface AdSummary {
  channelId: string;
  totalAds: number;
  totalSeconds: number;
  avgSeconds: number;
  perHour: AdHourBucket[];
}

@Injectable()
export class AdSummaryService {
  constructor(private readonly ch: ClickHouseClient) {}

  async summary(channelId: string, from?: string, to?: string): Promise<AdSummary> {
    const params = { channelId, from: from ?? '', to: to ?? '' };
    const where = `
      channel_id = {channelId:String}
      AND ({from:String} = '' OR started_at >= parseDateTimeBestEffortOrNull({from:String}))
      AND ({to:String} = '' OR started_at <= parseDateTimeBestEffortOrNull({to:String}))
    `;

    const totals = await this.ch.query<{
      total: string;
      totalSeconds: string;
      avgSeconds: string;
    }>(
      `SELECT count() AS total, sum(duration_seconds) AS totalSeconds,
              round(avg(duration_seconds), 1) AS avgSeconds
       FROM ad_segments WHERE ${where}`,
      params,
    );

    const perHour = await this.ch.query<AdHourBucket>(
      `SELECT toString(toStartOfHour(started_at)) AS bucket,
              count() AS ads, sum(duration_seconds) AS seconds
       FROM ad_segments WHERE ${where}
       GROUP BY bucket ORDER BY bucket`,
      params,
    );

    return {
      channelId,
      totalAds: Number(totals[0]?.total ?? 0),
      totalSeconds: Number(totals[0]?.totalSeconds ?? 0),
      avgSeconds: Number(totals[0]?.avgSeconds ?? 0),
      perHour: perHour.map((b) => ({
        bucket: b.bucket,
        ads: Number(b.ads),
        seconds: Number(b.seconds),
      })),
    };
  }
}
