/**
 * LlmBudgetAdminController — painel de custo de IA (SOMENTE role=admin).
 *
 *   GET    /api/v2/admin/llm-budget                       visão geral (defaults + canais + uso + custo)
 *   PATCH  /api/v2/admin/llm-budget/defaults              tetos/pausa globais
 *   PUT    /api/v2/admin/llm-budget/channels/:channelId   override do canal
 *   DELETE /api/v2/admin/llm-budget/channels/:channelId   remove override (volta a herdar)
 *   POST   /api/v2/admin/llm-budget/channels/:channelId/reset-month  zera o contador do mês
 *
 * Custo real (US$) do mês vem do ClickHouse (`sum(llm_cost_usd)` por canal);
 * tokens usados/restantes vêm do Redis (LlmRateLimiterService.getRemaining).
 * Ambos best-effort: indisponibilidade de CH/Redis não derruba o painel.
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  Optional,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { CHANNEL_REPOSITORY, type ChannelRepository } from '@sehloro/domain';
import { ClickHouseClient, LlmBudgetSettingsService, LlmRateLimiterService } from '@sehloro/infra';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';

const BudgetPatchSchema = z.object({
  monthlyTokens: z.number().int().positive().optional(),
  tokensPerMinute: z.number().int().positive().optional(),
  paused: z.boolean().optional(),
});

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

export interface ChannelBudgetRow {
  channelId: string;
  name: string;
  /** Teto efetivo aplicado hoje + origem (channel/global/env/default). */
  effective: {
    monthlyTokens: number;
    tokensPerMinute: number;
    paused: boolean;
    source: string;
  };
  /** Override explícito deste canal (null = herdando). */
  override: { monthlyTokens?: number; tokensPerMinute?: number; paused: boolean } | null;
  /** Tokens estimados consumidos no mês corrente (Redis). Null sem Redis. */
  usedMonthlyTokens: number | null;
  /** Custo real em US$ no mês corrente (ClickHouse). Null se o CH falhou. */
  costUsdMonth: number | null;
  /** ok | paused | blocked_monthly (uso >= teto) */
  status: 'ok' | 'paused' | 'blocked_monthly';
}

function assertAdmin(user: JwtPayload): void {
  if (user.role !== 'admin') throw new ForbiddenException();
}

@Controller('v2/admin/llm-budget')
export class LlmBudgetAdminController {
  private readonly logger = new Logger(LlmBudgetAdminController.name);

  constructor(
    private readonly settings: LlmBudgetSettingsService,
    private readonly ch: ClickHouseClient,
    @Inject(CHANNEL_REPOSITORY) private readonly channels: ChannelRepository,
    @Optional()
    @Inject(LlmRateLimiterService)
    private readonly limiter: LlmRateLimiterService | null,
  ) {}

  @Get()
  async overview(@CurrentUser() user: JwtPayload) {
    assertAdmin(user);

    const [globalInfo, overrides, active, cost] = await Promise.all([
      this.settings.getGlobal(),
      this.settings.listChannelOverrides(),
      this.channels.findAllActive().catch(() => []),
      this._costMonthByChannel(),
    ]);
    const costByChannel = cost.byChannel;
    const overrideByChannel = new Map(overrides.map((o) => [o.channelId, o]));

    // União: canais ativos + canais que só existem como override (ex.:
    // canal desativado mas ainda com pino de budget).
    const ids = new Map<string, string>(); // id → nome exibível
    for (const c of active) ids.set(c.getId(), c.getDisplayName() || c.getName() || c.getId());
    for (const o of overrides) if (!ids.has(o.channelId)) ids.set(o.channelId, o.channelId);

    const rows: ChannelBudgetRow[] = [];
    for (const [channelId, name] of ids) {
      const effective = await this.settings.getEffective(channelId);
      const o = overrideByChannel.get(channelId) ?? null;
      let usedMonthlyTokens: number | null = null;
      if (this.limiter) {
        try {
          const r = await this.limiter.getRemaining(channelId, new Date(), {
            monthlyBudget: effective.monthlyTokens,
            tokensPerMinute: effective.tokensPerMinute,
          });
          usedMonthlyTokens = r.usedMonthly;
        } catch {
          usedMonthlyTokens = null;
        }
      }
      const blocked = usedMonthlyTokens != null && usedMonthlyTokens >= effective.monthlyTokens;
      rows.push({
        channelId,
        name,
        effective,
        override: o
          ? { monthlyTokens: o.monthlyTokens, tokensPerMinute: o.tokensPerMinute, paused: o.paused }
          : null,
        usedMonthlyTokens,
        // CH respondeu → canal sem linhas no mês custou US$ 0 (não "sem dado").
        // Só é null quando a consulta em si falhou.
        costUsdMonth: cost.available ? (costByChannel.get(channelId) ?? 0) : null,
        status: effective.paused ? 'paused' : blocked ? 'blocked_monthly' : 'ok',
      });
    }
    // Mais caro primeiro — é a pergunta que o admin veio responder.
    rows.sort((a, b) => (b.costUsdMonth ?? 0) - (a.costUsdMonth ?? 0));

    return {
      defaults: globalInfo,
      channels: rows,
      redisAvailable: this.limiter != null,
    };
  }

  @Patch('defaults')
  async patchDefaults(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    assertAdmin(user);
    const patch = BudgetPatchSchema.parse(body);
    await this.settings.setGlobal(patch, user.username);
    this.logger.log(`defaults de budget alterados por ${user.username}: ${JSON.stringify(patch)}`);
    return { ok: true };
  }

  @Put('channels/:channelId')
  async putChannel(
    @Param('channelId') channelId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    assertAdmin(user);
    const patch = BudgetPatchSchema.parse(body);
    await this.settings.setChannel(channelId, patch, user.username);
    this.logger.log(
      `budget do canal ${channelId} alterado por ${user.username}: ${JSON.stringify(patch)}`,
    );
    return { ok: true };
  }

  @Delete('channels/:channelId')
  async deleteChannel(@Param('channelId') channelId: string, @CurrentUser() user: JwtPayload) {
    assertAdmin(user);
    await this.settings.deleteChannel(channelId);
    this.logger.log(`override de budget do canal ${channelId} removido por ${user.username}`);
    return { ok: true };
  }

  /** "Conceder mais budget agora": zera o contador mensal no Redis. */
  @Post('channels/:channelId/reset-month')
  async resetMonth(@Param('channelId') channelId: string, @CurrentUser() user: JwtPayload) {
    assertAdmin(user);
    if (!this.limiter) return { ok: false, reason: 'redis indisponível' };
    await this.limiter.resetMonthly(channelId);
    this.logger.log(`contador mensal de budget do canal ${channelId} zerado por ${user.username}`);
    return { ok: true };
  }

  /**
   * Custo real US$ do mês corrente por canal — best-effort (CH pode faltar).
   * `available` distingue "CH respondeu e este canal não gastou nada" de
   * "não deu para consultar" — sem isso um mês ainda sem batches ficava
   * indistinguível de ClickHouse fora do ar no painel.
   */
  private async _costMonthByChannel(): Promise<{
    available: boolean;
    byChannel: Map<string, number>;
  }> {
    try {
      const rows = await this.ch.query<{ channel_id: string; cost: string }>(
        `SELECT channel_id, sum(llm_cost_usd) AS cost
         FROM batch_analysis
         WHERE created_at >= toStartOfMonth(now())
         GROUP BY channel_id`,
        {},
      );
      return {
        available: true,
        byChannel: new Map(rows.map((r) => [r.channel_id, Number(r.cost)])),
      };
    } catch (err) {
      this.logger.warn(`custo mensal via ClickHouse indisponível: ${(err as Error).message}`);
      return { available: false, byChannel: new Map() };
    }
  }
}
