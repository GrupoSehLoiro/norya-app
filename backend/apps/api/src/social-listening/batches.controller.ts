import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { BatchMessagesMongooseRepository } from '@sehloro/infra';
import { toCsv, formatBrasilia } from '../legacy/csv.util';

interface FlatRow {
  batchId: string;
  channelId: string;
  windowStart: Date;
  windowEnd: Date;
  batchMessageCount: number;
  batchUniqueUsers: number;
  messageId: string;
  username: string;
  displayName: string;
  isSubscriber: boolean;
  isMod: boolean;
  text: string;
  receivedAt: Date;
  sentimentHint: string;
  emotes: string;
}

@Controller('v2/social-listening/batches')
export class BatchesController {
  constructor(private readonly repo: BatchMessagesMongooseRepository) {}

  /**
   * Lista batches de um canal — sem o array de mensagens (pra ficar leve).
   * Ordenado por windowStart DESC.
   */
  @Get()
  async list(@Query('channelId') channelId: string, @Query('limit') limitStr?: string) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const limit = limitStr ? Number(limitStr) : 100;
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new BadRequestException('limit inválido');
    }
    const items = await this.repo.listByChannel(channelId, limit);
    return { channelId, items };
  }

  /**
   * Export "flat" — uma linha por mensagem, com contexto do batch.
   * Aceita `from`/`to` (ISO) pra restringir janela; sem filtro = tudo
   * disponível (TTL de 7 dias na collection limita o teto).
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(
    @Query('channelId') channelId: string,
    @Res() res: Response,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      throw new BadRequestException('from inválido (ISO)');
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new BadRequestException('to inválido (ISO)');
    }

    const batches = await this.repo.listByChannelInRange({ channelId, from, to });

    const flat: FlatRow[] = batches.flatMap((b) =>
      b.messages.map((m) => ({
        batchId: b.batchId,
        channelId: b.channelId,
        windowStart: b.windowStart,
        windowEnd: b.windowEnd,
        batchMessageCount: b.messageCount,
        batchUniqueUsers: b.uniqueUsers,
        messageId: m.id,
        username: m.username,
        displayName: m.displayName ?? '',
        isSubscriber: m.isSubscriber,
        isMod: m.isMod,
        text: m.text,
        receivedAt: m.receivedAt,
        sentimentHint: m.sentimentHint ?? '',
        emotes: (m.emotes ?? []).join('|'),
      })),
    );

    const csv = toCsv<FlatRow>(flat, [
      { key: 'batchId', header: 'batchId' },
      { key: 'channelId', header: 'channelId' },
      {
        key: 'windowStart',
        header: 'windowStart',
        format: (v) => (v instanceof Date ? formatBrasilia(v) : ''),
      },
      {
        key: 'windowEnd',
        header: 'windowEnd',
        format: (v) => (v instanceof Date ? formatBrasilia(v) : ''),
      },
      { key: 'batchMessageCount', header: 'batchMessageCount' },
      { key: 'batchUniqueUsers', header: 'batchUniqueUsers' },
      { key: 'messageId', header: 'messageId' },
      { key: 'username', header: 'username' },
      { key: 'displayName', header: 'displayName' },
      { key: 'isSubscriber', header: 'isSubscriber' },
      { key: 'isMod', header: 'isMod' },
      { key: 'text', header: 'text' },
      {
        key: 'receivedAt',
        header: 'receivedAt',
        format: (v) => (v instanceof Date ? formatBrasilia(v) : ''),
      },
      { key: 'sentimentHint', header: 'sentimentHint' },
      { key: 'emotes', header: 'emotes' },
    ]);

    const tag = fromStr ? new Date(fromStr).toISOString().slice(0, 10) : 'all';
    res.setHeader('Content-Disposition', `attachment; filename="batches-${channelId}-${tag}.csv"`);
    res.send(csv);
  }

  /**
   * Detalhe de um batch — devolve as mensagens completas.
   */
  @Get(':batchId')
  async detail(@Param('batchId') batchId: string) {
    const row = await this.repo.findByBatchId(batchId);
    if (!row) throw new NotFoundException(`Batch ${batchId} não encontrado`);
    return row;
  }
}
