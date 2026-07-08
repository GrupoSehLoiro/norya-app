import { BadRequestException, Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PredictionsService, type PredictionRow } from './predictions.service';
import { ExportQuerySchema, ListQuerySchema } from '../dto/list-query.dto';
import { toCsv, formatBrasilia, type CsvColumn } from '../csv.util';

@Controller('v2/legacy/predictions')
export class PredictionsController {
  constructor(private readonly service: PredictionsService) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const parsed = ListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const page = await this.service.list(parsed.data);
    const channels = await this.service.listChannels();
    return { ...page, channels };
  }

  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    const parsed = ExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const rows = await this.service.exportRows(parsed.data);
    const columns: CsvColumn<PredictionRow>[] = [
      { key: 'channel', header: 'channel' },
      { key: 'title', header: 'title' },
      {
        key: 'createdAt',
        header: 'created_at',
        format: (v) => (typeof v === 'string' ? formatBrasilia(new Date(v)) : ''),
      },
      {
        key: 'endedAt',
        header: 'ended_at',
        format: (v) => (typeof v === 'string' ? formatBrasilia(new Date(v)) : ''),
      },
      {
        key: 'lockedAt',
        header: 'locked_at',
        format: (v) => (typeof v === 'string' ? formatBrasilia(new Date(v)) : ''),
      },
      { key: 'winningTitle', header: 'winBet' },
      { key: 'totalPoints', header: 'totalPontos' },
      { key: 'totalUsers', header: 'totalUsuarios' },
      { key: 'opt1', header: 'opt1', pick: (r) => r.options[0]?.title ?? '' },
      { key: 'totalOpt1', header: 'totalOpt1', pick: (r) => r.options[0]?.totalBetAmount ?? 0 },
      { key: 'totalUserOpt1', header: 'totalUserOpt1', pick: (r) => r.options[0]?.users ?? 0 },
      { key: 'opt2', header: 'opt2', pick: (r) => r.options[1]?.title ?? '' },
      { key: 'totalOpt2', header: 'totalOpt2', pick: (r) => r.options[1]?.totalBetAmount ?? 0 },
      { key: 'totalUserOpt2', header: 'totalUserOpt2', pick: (r) => r.options[1]?.users ?? 0 },
    ];
    const csv = toCsv(rows, columns);
    res.setHeader('Content-Disposition', `attachment; filename="predictions-${Date.now()}.csv"`);
    res.send(csv);
  }
}
