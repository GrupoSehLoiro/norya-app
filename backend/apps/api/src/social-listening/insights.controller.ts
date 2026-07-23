import { BadRequestException, Controller, Get, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AiContextResolverService, ReportLlmService } from '@sehloro/infra';
import { InsightsService } from './insights.service';
import { InsightsReportService } from './insights-report.service';
import { ReportPdfService } from './report-pdf.service';
import { HtmlPdfRendererService } from './html-pdf-renderer.service';
import { buildReportHtml } from './report-html';
import { EmotesService } from './emotes.service';
import { MessageSearchService } from './message-search.service';

@Controller('v2/social-listening/insights')
export class InsightsController {
  private readonly logger = new Logger(InsightsController.name);

  constructor(
    private readonly service: InsightsService,
    private readonly reports: InsightsReportService,
    private readonly pdf: ReportPdfService,
    private readonly htmlPdf: HtmlPdfRendererService,
    private readonly emotes: EmotesService,
    private readonly messages: MessageSearchService,
    private readonly reportLlm: ReportLlmService,
    private readonly aiContext: AiContextResolverService,
  ) {}

  /**
   * Relatório PDF da live no período (range do gráfico de /insights):
   * agrega os batches, gera o texto pela IA (mesma dos batches) e devolve o
   * PDF como download. GET /api/v2/social-listening/insights/report.pdf
   */
  @Get('report.pdf')
  async reportPdf(
    @Query('channelId') channelId: string,
    @Query('from') fromStr: string,
    @Query('to') toStr: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from/to inválido');
    }
    const data = await this.reports.build(channelId, from, to);
    const buffer = await this._renderPdf(channelId, data);
    const fname = `relatorio-${channelId}-${to.toISOString().slice(0, 10)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  /**
   * Caminho preferido: HTML → Chromium (emotes como imagem). Sem Chromium na
   * máquina, ou com erro no render, cai no pdfkit (texto puro) — o relatório
   * nunca deixa de sair.
   */
  private async _renderPdf(
    channelId: string,
    data: Awaited<ReturnType<InsightsReportService['build']>>,
  ): Promise<Buffer> {
    if (this.htmlPdf.isAvailable()) {
      try {
        const dict = await this.emotes
          .forChannel(channelId)
          .then((r) => r.emotes)
          .catch(() => []);
        return await this.htmlPdf.render(buildReportHtml(data, dict));
      } catch (err) {
        this.logger.warn(`render HTML→PDF falhou, caindo p/ pdfkit: ${(err as Error).message}`);
      }
    }
    return this.pdf.render(data);
  }

  /**
   * Métricas agregadas do período — os mesmos números dos cards do relatório
   * PDF (mensagens, dias ativos, pico de usuários, janelas), para os boxes
   * da página de análise. GET /api/v2/social-listening/insights/summary
   */
  @Get('summary')
  async summary(
    @Query('channelId') channelId: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getTime() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from/to inválido');
    }
    const m = await this.reports.metrics(channelId, from, to);
    return {
      channelId,
      totalMessages: m.totalMessages,
      activeDays: m.activeDays,
      peakUsers: m.peakUsers,
      windows: m.windows,
      peak: m.peak,
      topKeywords: m.topKeywords,
    };
  }

  /**
   * Insight sob demanda de um recorte livre de mensagens — por janela de
   * tempo (ex.: pico do gráfico) e/ou termo (ex.: marca "redbull"). Reúne as
   * mensagens do recorte e pede um resumo curto à IA.
   * GET /api/v2/social-listening/insights/window-insight
   */
  @Get('window-insight')
  async windowInsight(
    @Query('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const result = await this.messages.search({ channelId, q, from, to, limit: 200 });

    const sample = result.items
      .slice(0, 80)
      .map((m) => `${m.isMod ? '[mod] ' : ''}${m.username}: ${m.text}`)
      .join('\n');

    let insight =
      result.total > 0
        ? `Recorte com ${result.total} mensagens. Ative a IA (LLM_DRIVER=real) para um resumo descritivo.`
        : 'Nenhuma mensagem nesse recorte.';
    let aiEnabled = false;
    if (result.total > 0) {
      const scope = q
        ? `mensagens que mencionam "${q}"`
        : 'mensagens do trecho selecionado da live';
      const extraContext = (await this.aiContext.resolveForChannel(channelId)) ?? undefined;
      const ai = await this.reportLlm.quickInsight({
        channelName: channelId,
        context: `Resuma o contexto destas ${scope} (${result.total} no total):\n${sample}`,
        extraContext,
      });
      if (ai) {
        insight = ai;
        aiEnabled = true;
      }
    }

    return {
      channelId,
      q: q ?? '',
      from: from ?? null,
      to: to ?? null,
      total: result.total,
      insight,
      aiEnabled,
      sample: result.items.slice(0, 30),
    };
  }

  @Get('latest')
  async latest(@Query('channelId') channelId: string) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return { channelId, analysis: await this.service.latest(channelId) };
  }

  @Get('history')
  async history(
    @Query('channelId') channelId: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;
    const limit = limitStr ? Number(limitStr) : 200;
    if (limit > 0 === false) throw new BadRequestException('limit deve ser positivo');
    const items = await this.service.history(channelId, from, to, limit);
    return { channelId, items };
  }
}
