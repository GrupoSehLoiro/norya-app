/**
 * Treinamento IA — endpoints admin (role GLOBAL 'admin', mesmo padrão inline
 * do FeatureFlagsController).
 *
 * Nota de rota: key vai no BODY/query-string (não no path) porque chaves de
 * item contêm '/' ("fps/valorant") — path param quebraria em 2 segmentos.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AI_CONTEXT_PROMPTS_PER_NODE,
  AI_CONTEXT_PROMPT_MAX,
  AI_CONTEXT_SCOPES,
} from '@sehloro/infra';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { AiTrainingService } from './ai-training.service';

const UpsertSchema = z.object({
  scope: z.enum(AI_CONTEXT_SCOPES),
  key: z.string().max(120).default(''),
  prompts: z
    .array(z.string().min(1).max(AI_CONTEXT_PROMPT_MAX))
    .min(1)
    .max(AI_CONTEXT_PROMPTS_PER_NODE),
  enabled: z.boolean().default(true),
});

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

@Controller('v2/admin/ai-training')
export class AiTrainingController {
  constructor(private readonly service: AiTrainingService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    this._assertAdmin(user);
    return { items: await this.service.list() };
  }

  @Put()
  async upsert(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    this._assertAdmin(user);
    const parsed = UpsertSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.service.upsert(parsed.data, user.username);
  }

  @Delete()
  async remove(
    @Query('scope') scope: string | undefined,
    @Query('key') key: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    this._assertAdmin(user);
    const parsedScope = z.enum(AI_CONTEXT_SCOPES).safeParse(scope);
    if (!parsedScope.success) throw new BadRequestException('scope inválido');
    await this.service.remove(parsedScope.data, key ?? '');
    return { ok: true };
  }

  /** Contexto final montado para um canal — o que a IA vai receber. */
  @Get('preview')
  async preview(
    @Query('channelId') channelId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    this._assertAdmin(user);
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const resolved = await this.service.preview(channelId);
    return { channelId, context: resolved.text, parts: resolved.parts };
  }

  private _assertAdmin(user: JwtPayload): void {
    if (user.role !== 'admin') throw new ForbiddenException();
  }
}
