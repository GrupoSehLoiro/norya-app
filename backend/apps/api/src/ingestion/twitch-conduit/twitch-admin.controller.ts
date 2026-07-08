/**
 * CON-05 · TwitchAdminController.
 *
 * Endpoints administrativos de conduits/subscriptions Twitch:
 *  GET    /api/v2/admin/twitch/subscriptions       — lista local + status agregado
 *  POST   /api/v2/admin/twitch/subscriptions/renew — força execução do renewer
 *
 * Apenas admin (role=admin) pode acessar. Os endpoints respeitam o
 * JwtAuthGuard global; o gate de role é feito inline.
 */
import { Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TwitchConduitSubscriptionsService } from '@sehloro/infra';
import { CurrentUser, AuthUser } from '../../identity/auth/decorators/current-user.decorator';
import { SubscriptionRenewerCron } from './subscription-renewer.cron';

@Controller('v2/admin/twitch')
export class TwitchAdminController {
  constructor(
    private readonly subscriptions: TwitchConduitSubscriptionsService,
    private readonly renewer: SubscriptionRenewerCron,
  ) {}

  @Get('subscriptions')
  async list(@CurrentUser() user: AuthUser) {
    this._assertAdmin(user);
    const active = await this.subscriptions.listActive();
    const summary = aggregate(active);
    return {
      subscriptions: active.map((s) => ({
        channelId: String(s.channelId),
        channelExternalId: s.channelExternalId,
        type: s.type,
        status: s.status,
        subscriptionId: s.subscriptionId,
        conduitId: s.conduitId,
        revokedAt: s.revokedAt ?? null,
      })),
      summary,
    };
  }

  @Post('subscriptions/renew')
  @HttpCode(HttpStatus.OK)
  async renew(@CurrentUser() user: AuthUser) {
    this._assertAdmin(user);
    const stats = await this.renewer.runOnce();
    return { ranWithFlagEnabled: stats !== null, stats };
  }

  private _assertAdmin(user: AuthUser | undefined): void {
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Apenas admins');
    }
  }
}

function aggregate(subs: Array<{ type: string; status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of subs) {
    const key = `${s.type}:${s.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
