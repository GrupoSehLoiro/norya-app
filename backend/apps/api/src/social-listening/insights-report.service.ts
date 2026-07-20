/**
 * InsightsReportService — monta o relatório de análise da live para um canal
 * e período (o range visível no gráfico de /insights).
 *
 * Pipeline:
 *   1. agrega os `batch_analysis` do período (sentimento, pautas, tokens,
 *      marcas, usuários tóxicos, pico de engajamento, dias ativos);
 *   2. amostra mensagens reais do chat (Mongo batch_messages) para dar
 *      contexto editorial à IA;
 *   3. pede o TEXTO do relatório à mesma IA dos batches (ReportLlmService);
 *      se a IA não estiver ativa/falhar, cai num template a partir dos números.
 *
 * O resultado (ReportData) alimenta o ReportPdfService.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CHANNEL_REPOSITORY, type ChannelRepository } from '@sehloro/domain';
import {
  AiContextResolverService,
  BatchMessagesMongooseRepository,
  ReportLlmService,
  type ReportNarrative,
} from '@sehloro/infra';
import { InsightsService } from './insights.service';
import type { BatchAnalysis } from './batch-analysis.types';

export interface ReportMetrics {
  totalMessages: number;
  activeDays: number;
  peakUsers: number;
  windows: number; // nº de janelas (batches) analisadas
  peak: { at: Date; messages: number } | null;
  sentiment: { pos: number; neu: number; neg: number }; // 0..1
  topCategories: Array<{ category: string; count: number }>;
  topKeywords: Array<{ word: string; count: number }>;
  brands: Array<{ brand: string; count: number }>;
  toxicUsers: Array<{ username: string; ratio: number }>;
}

export interface ReportData {
  channelName: string;
  from: Date;
  to: Date;
  metrics: ReportMetrics;
  narrative: ReportNarrative;
  generatedByAi: boolean;
  sampleSize: number;
  /** Resumo IA do momento do pico (±10min em torno de metrics.peak). */
  peakInsight: string | null;
}

const SAMPLE_TARGET = 60;

/**
 * Remove surrogates UTF-16 órfãos (high sem low, ou low sem high). Esses bytes
 * aparecem quando o chat traz emojis/caracteres truncados; ao serializar o body
 * da requisição, a API da IA rejeita com 400 ("no low surrogate in string").
 * Pares válidos (emojis inteiros) são preservados.
 */
function stripLoneSurrogates(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

@Injectable()
export class InsightsReportService {
  private readonly logger = new Logger(InsightsReportService.name);

  constructor(
    private readonly insights: InsightsService,
    private readonly batchMessages: BatchMessagesMongooseRepository,
    private readonly reportLlm: ReportLlmService,
    private readonly aiContext: AiContextResolverService,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
  ) {}

  async build(channelId: string, from: Date, to: Date): Promise<ReportData> {
    const [batches, channel] = await Promise.all([
      this.insights.history(channelId, from, to, 1000),
      this.channels.findById(channelId).catch(() => null),
    ]);
    const channelName = channel?.getDisplayName() || channel?.getName() || channelId;

    const metrics = this._aggregate(batches);
    const sample = await this._sampleMessages(channelId, from, to);

    const context = this._buildContext(metrics, from, to, sample);
    const extraContext = (await this.aiContext.resolveForChannel(channelId)) ?? undefined;
    const ai = await this.reportLlm.generate({ context, channelName, extraContext });
    const narrative = ai ?? this._templateNarrative(metrics, channelName);
    const peakInsight = await this._peakInsight(channelId, channelName, metrics, extraContext);

    return {
      channelName,
      from,
      to,
      metrics,
      narrative,
      generatedByAi: Boolean(ai),
      sampleSize: sample.length,
      peakInsight,
    };
  }

  /**
   * "O que aconteceu no pico" — mesmo recorte do drill-down da timeline
   * (±10min em torno do pico), resumido pela IA para o relatório.
   */
  private async _peakInsight(
    channelId: string,
    channelName: string,
    metrics: ReportMetrics,
    extraContext?: string,
  ): Promise<string | null> {
    if (!metrics.peak) return null;
    const from = new Date(metrics.peak.at.getTime() - 10 * 60_000);
    const to = new Date(metrics.peak.at.getTime() + 10 * 60_000);
    const rows = await this.batchMessages
      .listByChannelInRange({ channelId, from, to, limit: 40 })
      .catch(() => []);
    const texts: string[] = [];
    for (const r of rows) {
      for (const m of r.messages) {
        const t = (m.text ?? '').trim();
        if (t) texts.push(`${m.username}: ${t.slice(0, 180)}`);
        if (texts.length >= 60) break;
      }
      if (texts.length >= 60) break;
    }
    if (texts.length === 0) return null;
    return this.reportLlm.quickInsight({
      channelName,
      context:
        `Mensagens do momento de pico da live (${metrics.peak.messages} msgs na janela):\n` +
        stripLoneSurrogates(texts.join('\n')),
      extraContext,
    });
  }

  /**
   * Só as métricas agregadas do período (sem narrativa IA) — alimenta os
   * boxes de resumo da página de análise, os mesmos números do PDF.
   */
  async metrics(channelId: string, from: Date, to: Date): Promise<ReportMetrics> {
    const batches = await this.insights.history(channelId, from, to, 1000);
    return this._aggregate(batches);
  }

  private _aggregate(batches: BatchAnalysis[]): ReportMetrics {
    let totalMessages = 0;
    let peakUsers = 0;
    let pos = 0;
    let neu = 0;
    let neg = 0;
    let peak: { at: Date; messages: number } | null = null;
    const days = new Set<string>();
    const cats = new Map<string, number>();
    const toks = new Map<string, number>();
    const brands = new Map<string, number>();
    const tox = new Map<string, number>();

    for (const b of batches) {
      totalMessages += b.messageCount;
      peakUsers = Math.max(peakUsers, b.uniqueUsers);
      pos += (b.climaGeral?.pos ?? 0) * b.messageCount;
      neu += (b.climaGeral?.neu ?? 0) * b.messageCount;
      neg += (b.climaGeral?.neg ?? 0) * b.messageCount;
      if (!peak || b.messageCount > peak.messages) {
        peak = { at: new Date(b.windowStart), messages: b.messageCount };
      }
      days.add(new Date(b.windowStart).toISOString().slice(0, 10));
      if (b.pautaMaisComentada?.category && b.pautaMaisComentada.category !== 'other') {
        const c = b.pautaMaisComentada.category;
        cats.set(c, (cats.get(c) ?? 0) + Math.max(1, b.pautaMaisComentada.count ?? 0));
      }
      for (const t of b.topTokens ?? []) toks.set(t, (toks.get(t) ?? 0) + 1);
      for (const m of b.marcasMencionadas ?? []) {
        brands.set(m.brand, (brands.get(m.brand) ?? 0) + (m.count ?? 1));
      }
      if (b.userMaisToxico?.username) {
        const u = b.userMaisToxico.username;
        tox.set(u, Math.max(tox.get(u) ?? 0, b.userMaisToxico.ratio ?? 0));
      }
    }

    const denom = totalMessages || 1;
    const topN = <T>(m: Map<string, number>, n: number, key: (k: string, v: number) => T): T[] =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => key(k, v));

    return {
      totalMessages,
      activeDays: days.size,
      peakUsers,
      windows: batches.length,
      peak,
      sentiment: { pos: pos / denom, neu: neu / denom, neg: neg / denom },
      topCategories: topN(cats, 8, (category, count) => ({ category, count })),
      topKeywords: topN(toks, 16, (word, count) => ({ word, count })),
      brands: topN(brands, 10, (brand, count) => ({ brand, count })),
      toxicUsers: topN(tox, 6, (username, ratio) => ({ username, ratio })),
    };
  }

  private async _sampleMessages(channelId: string, from: Date, to: Date): Promise<string[]> {
    const rows = await this.batchMessages
      .listByChannelInRange({ channelId, from, to, limit: 400 })
      .catch(() => []);
    const all: string[] = [];
    for (const r of rows) {
      for (const m of r.messages) {
        const text = (m.text ?? '').trim();
        if (text) all.push(`${m.username}: ${text.slice(0, 180)}`);
      }
    }
    if (all.length <= SAMPLE_TARGET) return all;
    // Amostra espalhada pelo período (1 a cada step) para representar a live toda.
    const step = Math.ceil(all.length / SAMPLE_TARGET);
    const out: string[] = [];
    for (let i = 0; i < all.length && out.length < SAMPLE_TARGET; i += step) out.push(all[i]!);
    return out;
  }

  private _buildContext(m: ReportMetrics, from: Date, to: Date, sample: string[]): string {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const lines = [
      `Período: ${from.toISOString()} até ${to.toISOString()} (${m.activeDays} dia(s) com atividade).`,
      `Total de mensagens: ${m.totalMessages}.`,
      m.peak
        ? `Pico de engajamento: ${m.peak.messages} msgs numa janela em ${m.peak.at.toISOString()}.`
        : '',
      `Pico de usuários únicos numa janela: ${m.peakUsers}.`,
      `Sentimento geral (ponderado por volume): positivo ${pct(m.sentiment.pos)}, neutro ${pct(m.sentiment.neu)}, negativo ${pct(m.sentiment.neg)}.`,
      m.topCategories.length
        ? `Pautas mais comentadas: ${m.topCategories.map((c) => `${c.category} (${c.count})`).join(', ')}.`
        : '',
      m.topKeywords.length
        ? `Palavras-chave mais usadas: ${m.topKeywords.map((k) => k.word).join(', ')}.`
        : '',
      m.brands.length
        ? `Marcas mencionadas: ${m.brands.map((b) => `${b.brand} (${b.count})`).join(', ')}.`
        : '',
      m.toxicUsers.length
        ? `Usuários com maior toxicidade: ${m.toxicUsers.map((u) => `${u.username} (${pct(u.ratio)})`).join(', ')}.`
        : '',
      '',
      sample.length
        ? `Amostra de ${sample.length} mensagens do chat:\n${sample.join('\n')}`
        : 'Sem amostra de mensagens disponível.',
    ];
    // Remove surrogates UTF-16 soltos (metades de emoji/caractere quebrado vindas
    // do chat). Sem isso o body vira JSON inválido e a API da IA responde 400.
    return stripLoneSurrogates(lines.filter(Boolean).join('\n'));
  }

  /** Relatório-template quando a IA não está ativa — usa os números reais. */
  private _templateNarrative(m: ReportMetrics, channelName: string): ReportNarrative {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const dominante =
      m.sentiment.pos >= m.sentiment.neg && m.sentiment.pos >= m.sentiment.neu
        ? 'positivo'
        : m.sentiment.neg >= m.sentiment.neu
          ? 'negativo'
          : 'neutro';
    const avgPerDay = m.activeDays ? Math.round(m.totalMessages / m.activeDays) : m.totalMessages;
    const fmtDate = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return {
      resumoExecutivo:
        `No período analisado, o canal ${channelName} registrou ${m.totalMessages} mensagens ` +
        `ao longo de ${m.activeDays} dia(s) de atividade (média de ${avgPerDay} por dia), ` +
        `distribuídas em ${m.windows} janelas de análise. O clima foi predominantemente ${dominante} ` +
        `(${pct(m.sentiment.pos)} positivo / ${pct(m.sentiment.neu)} neutro / ${pct(m.sentiment.neg)} negativo)` +
        (m.peak ? `, com pico de ${m.peak.messages} mensagens em ${fmtDate(m.peak.at)}.` : '.'),
      secoes: [
        {
          titulo: 'Clima e sentimento',
          corpo:
            `A análise de sentimento ponderada por volume aponta ${pct(m.sentiment.pos)} de mensagens positivas, ` +
            `${pct(m.sentiment.neu)} neutras e ${pct(m.sentiment.neg)} negativas. ` +
            `O tom dominante do chat foi ${dominante}. ` +
            (m.peak
              ? `O maior pico de engajamento concentrou ${m.peak.messages} mensagens numa única janela, em ${fmtDate(m.peak.at)}.`
              : ''),
        },
        {
          titulo: 'Pautas do chat',
          corpo: m.topCategories.length
            ? `Foram identificadas ${m.topCategories.length} pautas dominantes. As mais comentadas foram ` +
              `${m.topCategories
                .slice(0, 5)
                .map((c) => `${c.category} (${c.count})`)
                .join(', ')}` +
              `${m.topCategories.length > 5 ? ', entre outras' : ''}. ` +
              `A pauta líder (${m.topCategories[0]?.category}) concentrou ${m.topCategories[0]?.count} menções.`
            : 'Não houve concentração clara de pautas no período.',
        },
        {
          titulo: 'Público e palavras-chave',
          corpo:
            `O pico de usuários únicos numa janela foi de ${m.peakUsers}, com média de ${avgPerDay} mensagens por dia ativo. ` +
            (m.topKeywords.length
              ? `Os termos mais recorrentes no chat foram: ${m.topKeywords
                  .slice(0, 12)
                  .map((k) => k.word)
                  .join(', ')}.`
              : 'Não houve termos com recorrência destacada.'),
        },
        ...(m.brands.length
          ? [
              {
                titulo: 'Menções a marcas',
                corpo:
                  `Foram detectadas menções orgânicas a ${m.brands.length} marca(s). ` +
                  `As mais citadas: ${m.brands.map((b) => `${b.brand} (${b.count})`).join(', ')}. ` +
                  `A marca de maior destaque foi ${m.brands[0]?.brand}, com ${m.brands[0]?.count} menções.`,
              },
            ]
          : []),
        ...(m.toxicUsers.length
          ? [
              {
                titulo: 'Moderação e atritos',
                corpo:
                  `Foram sinalizados ${m.toxicUsers.length} usuário(s) com maior índice de toxicidade no período: ` +
                  `${m.toxicUsers.map((u) => `${u.username} (${pct(u.ratio)})`).join(', ')}. ` +
                  `Esses perfis concentraram a maior parte das mensagens classificadas como negativas.`,
              },
            ]
          : []),
      ],
    };
  }
}
