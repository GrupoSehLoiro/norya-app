import { BadRequestException, Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EmojisService } from './emojis.service';
import { ExportQuerySchema, ListQuerySchema } from '../dto/list-query.dto';
import { toCsv, formatBrasilia } from '../csv.util';

@Controller('v2/legacy/emojis')
export class EmojisController {
  constructor(private readonly service: EmojisService) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const parsed = ListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.service.list(parsed.data);
  }

  @Get('count')
  async count() {
    return { count: await this.service.count() };
  }

  @Get('count-by-channel')
  async countByChannel() {
    return { items: await this.service.countByChannel() };
  }

  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(@Query() query: Record<string, string>, @Res() res: Response) {
    const parsed = ExportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const rows = await this.service.exportRows(parsed.data);
    const csv = toCsv(rows, [
      { key: 'channel', header: 'channel' },
      { key: 'username', header: 'username' },
      { key: 'message', header: 'message' },
      { key: 'emoji', header: 'emoji' },
      {
        key: 'timestamp',
        header: 'timestamp',
        format: (v) => (typeof v === 'string' ? formatBrasilia(new Date(v)) : ''),
      },
    ]);
    res.setHeader('Content-Disposition', `attachment; filename="emojis-${Date.now()}.csv"`);
    res.send(csv);
  }
}
