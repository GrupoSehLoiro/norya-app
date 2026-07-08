import { BadRequestException, Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PollsService, type PollRow } from './polls.service';
import { ExportQuerySchema, ListQuerySchema } from '../dto/list-query.dto';
import { toCsv, formatBrasilia, type CsvColumn } from '../csv.util';

@Controller('v2/legacy/polls')
export class PollsController {
  constructor(private readonly service: PollsService) {}

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
    const maxChoices = rows.reduce((m, r) => Math.max(m, r.choices.length), 0);

    const baseColumns: CsvColumn<PollRow>[] = [
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
      { key: 'duration', header: 'duration' },
      { key: 'totalVotes', header: 'totalVotes' },
      { key: 'totalChannelPointsVotes', header: 'totalChannelPointsVotes' },
      { key: 'totalBitsVotes', header: 'totalBitsVotes' },
      { key: 'totalAllVotes', header: 'totalAllVotes' },
      { key: 'winningTitle', header: 'winPoll' },
    ];

    const choiceColumns: CsvColumn<PollRow>[] = [];
    for (let i = 0; i < maxChoices; i++) {
      const idx = i + 1;
      choiceColumns.push(
        {
          key: `c${idx}_title`,
          header: `choice_${idx}_title`,
          pick: (r) => r.choices[i]?.title ?? '',
        },
        {
          key: `c${idx}_votes`,
          header: `choice_${idx}_votes`,
          pick: (r) => r.choices[i]?.votes ?? '',
        },
        {
          key: `c${idx}_cp`,
          header: `choice_${idx}_channel_points_votes`,
          pick: (r) => r.choices[i]?.channelPointsVotes ?? '',
        },
        {
          key: `c${idx}_bits`,
          header: `choice_${idx}_bits_votes`,
          pick: (r) => r.choices[i]?.bitsVotes ?? '',
        },
        {
          key: `c${idx}_total`,
          header: `choice_${idx}_total_votes`,
          pick: (r) => r.choices[i]?.totalVotes ?? '',
        },
      );
    }

    const csv = toCsv(rows, [...baseColumns, ...choiceColumns]);
    res.setHeader('Content-Disposition', `attachment; filename="polls-${Date.now()}.csv"`);
    res.send(csv);
  }
}
