/**
 * TopicsService — "Assuntos do chat": agrega `batch_analysis` (tokens/categorias/
 * mensagens) de um canal num período e pede ao Haiku uma descrição + labels dos
 * assuntos mais comentados. Sem IA (driver != real / sem chave) → fallback
 * heurístico a partir de tokens/categorias. Valida só contra ClickHouse real.
 */
import { Inject, Injectable } from '@nestjs/common';
import { CHANNEL_REPOSITORY, ChannelRepository } from '@sehloro/domain';
import { AiContextResolverService, ClickHouseClient, ReportLlmService } from '@sehloro/infra';

export interface ChatTopics {
  channelId: string;
  from: string | null;
  to: string | null;
  messageCount: number;
  topTokens: { token: string; count: number }[];
  topCategories: { category: string; messages: number }[];
  labels: string[];
  summary: string;
  aiEnabled: boolean;
}

@Injectable()
export class TopicsService {
  constructor(
    private readonly ch: ClickHouseClient,
    private readonly reportLlm: ReportLlmService,
    private readonly aiContext: AiContextResolverService,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
  ) {}

  async topics(channelId: string, from?: string, to?: string): Promise<ChatTopics> {
    const params = { channelId, from: from ?? '', to: to ?? '' };
    const range = `
      channel_id = {channelId:String}
      AND ({from:String} = '' OR created_at >= parseDateTimeBestEffortOrNull({from:String}))
      AND ({to:String} = '' OR created_at <= parseDateTimeBestEffortOrNull({to:String}))
    `;

    const [totals, tokensRows, catsRows] = await Promise.all([
      this.ch.query<{ total: string }>(
        `SELECT sum(message_count) AS total FROM batch_analysis WHERE ${range}`,
        params,
      ),
      this.ch.query<{ token: string; c: string }>(
        `SELECT token, count() AS c FROM (
           SELECT arrayJoin(top_tokens) AS token FROM batch_analysis WHERE ${range}
         ) WHERE token != '' GROUP BY token ORDER BY c DESC LIMIT 15`,
        params,
      ),
      this.ch.query<{ category: string; msgs: string }>(
        `SELECT dominant_category AS category, sum(message_count) AS msgs
         FROM batch_analysis WHERE ${range} AND dominant_category != ''
         GROUP BY category ORDER BY msgs DESC LIMIT 8`,
        params,
      ),
    ]);

    const messageCount = Number(totals[0]?.total ?? 0);
    const topTokens = tokensRows.map((r) => ({ token: r.token, count: Number(r.c) }));
    const topCategories = catsRows.map((r) => ({
      category: r.category,
      messages: Number(r.msgs),
    }));

    const channelName = (await this.channels.findById(channelId))?.getName() ?? channelId;

    // Heurística base (também é o fallback sem IA).
    const heuristicLabels = [
      ...topCategories.map((c) => c.category),
      ...topTokens.slice(0, 6).map((t) => t.token),
    ]
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .slice(0, 8);

    let labels = heuristicLabels;
    let summary =
      messageCount > 0
        ? `No período, o chat somou ${messageCount} mensagens. Assuntos mais frequentes: ${heuristicLabels.join(', ') || '—'}.`
        : 'Sem mensagens no período selecionado.';
    let aiEnabled = false;

    if (messageCount > 0 && this.reportLlm.isAiEnabled()) {
      const context =
        `Mensagens no período: ${messageCount}\n` +
        `Categorias dominantes (por mensagens): ${topCategories.map((c) => `${c.category} (${c.messages})`).join(', ') || '—'}\n` +
        `Tokens mais frequentes: ${topTokens.map((t) => `${t.token} (${t.count})`).join(', ') || '—'}`;
      const extraContext = (await this.aiContext.resolveForChannel(channelId)) ?? undefined;
      const ai = await this.reportLlm.describeTopics({ channelName, context, extraContext });
      if (ai) {
        aiEnabled = true;
        if (ai.labels.length) labels = ai.labels;
        if (ai.resumo) summary = ai.resumo;
      }
    }

    return {
      channelId,
      from: from ?? null,
      to: to ?? null,
      messageCount,
      topTokens,
      topCategories,
      labels,
      summary,
      aiEnabled,
    };
  }

  /**
   * Histórico de assuntos por timestamp — agrupa batch_analysis por hora,
   * com labels heurísticas (categoria dominante + tokens). Permite ver os
   * assuntos anteriores do chat ao longo do tempo. Mais recente primeiro.
   */
  async history(channelId: string, from?: string, to?: string): Promise<TopicBucket[]> {
    const params = { channelId, from: from ?? '', to: to ?? '' };
    const range = `
      channel_id = {channelId:String}
      AND ({from:String} = '' OR created_at >= parseDateTimeBestEffortOrNull({from:String}))
      AND ({to:String} = '' OR created_at <= parseDateTimeBestEffortOrNull({to:String}))
    `;
    const rows = await this.ch.query<{
      bucket: string;
      msgs: string;
      domcat: string;
      tokens: string[];
    }>(
      `SELECT toString(toStartOfHour(created_at)) AS bucket,
              sum(message_count) AS msgs,
              argMax(dominant_category, message_count) AS domcat,
              arrayFlatten(groupArray(top_tokens)) AS tokens
       FROM batch_analysis WHERE ${range}
       GROUP BY bucket ORDER BY bucket DESC LIMIT 72`,
      params,
    );
    return rows.map((r) => {
      const labels = [r.domcat, ...(r.tokens ?? [])]
        .filter((v, i, a) => v && a.indexOf(v) === i)
        .slice(0, 6);
      return {
        bucket: r.bucket,
        messageCount: Number(r.msgs),
        dominantCategory: r.domcat ?? '',
        labels,
      };
    });
  }
}

export interface TopicBucket {
  bucket: string;
  messageCount: number;
  dominantCategory: string;
  labels: string[];
}
