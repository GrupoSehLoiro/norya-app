import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InsightsService } from './insights.service';
import { InsightsReportService } from './insights-report.service';
import { ReportPdfService } from './report-pdf.service';

@Controller('v2/social-listening/insights')
export class InsightsController {
  constructor(
    private readonly service: InsightsService,
    private readonly reports: InsightsReportService,
    private readonly pdf: ReportPdfService,
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
    const buffer = await this.pdf.render(data);
    const fname = `relatorio-${channelId}-${to.toISOString().slice(0, 10)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
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
