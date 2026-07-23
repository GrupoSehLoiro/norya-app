import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { RequireWsRole } from '../identity/auth/decorators/require-ws-role.decorator';
import { BrandService } from './brand.service';
import { BrandCountsService, type BrandCount } from './brand-counts.service';

const CreateSchema = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1).max(80),
  aliases: z.array(z.string().min(1).max(80)).max(20).optional(),
  regex: z.string().max(200).nullable().optional(),
});

@Controller('v2/social-listening/brands')
export class BrandController {
  constructor(
    private readonly service: BrandService,
    private readonly counts: BrandCountsService,
  ) {}

  @Get()
  async list(@Query('channelId') channelId: string) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.service.list(channelId);
  }

  /**
   * Palavras cadastradas do canal + contagem de menções no período, contada
   * sobre o texto real (retroativo). Base do card "Palavras-chave".
   */
  @Get('counts')
  async brandCounts(
    @Query('channelId') channelId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<BrandCount[]> {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    return this.counts.counts(channelId, from, to);
  }

  /**
   * Criar/editar marcas exige role de workspace `manager`+ (owner/admin/manager)
   * — migrado do gate legado `role==='admin'` para o RBAC por workspace, para
   * o dono do canal gerenciar suas próprias marcas (ex.: no onboarding).
   */
  @Post()
  @RequireWsRole('manager')
  async create(@Body() body: unknown) {
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    return this.service.create(
      parsed.data.channelId,
      parsed.data.name,
      parsed.data.aliases,
      parsed.data.regex ?? null,
    );
  }

  @Delete(':id')
  @RequireWsRole('manager')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
    return { ok: true };
  }
}
