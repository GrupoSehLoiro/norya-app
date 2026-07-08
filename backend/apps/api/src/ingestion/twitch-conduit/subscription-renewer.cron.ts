/**
 * CON-05 · SubscriptionRenewerCron.
 *
 * Wrap @Cron diário 04:00 sobre SubscriptionRenewerService. O service real
 * vive em @sehloro/infra para que o worker (se quisermos rodar lá ao invés
 * da API) possa importar a mesma lógica.
 *
 * Gating: feature flag `twitch.subscription.autoRenew` (default true via FF-02).
 * Quando desligada, o cron loga e pula a varredura sem chamar o service.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionRenewerService, type RenewerStats } from '@sehloro/infra';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';

const AUTO_RENEW_FLAG = 'twitch.subscription.autoRenew';

@Injectable()
export class SubscriptionRenewerCron {
  private readonly logger = new Logger(SubscriptionRenewerCron.name);

  constructor(
    private readonly renewer: SubscriptionRenewerService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** Diário às 04:00. */
  @Cron('0 4 * * *')
  async daily(): Promise<RenewerStats | null> {
    return this.runOnce();
  }

  /**
   * Execução manual exposta para o admin controller — útil em incidente,
   * sem ter que esperar até o próximo 04:00.
   */
  async runOnce(): Promise<RenewerStats | null> {
    const enabled = await this.flags.isEnabled(AUTO_RENEW_FLAG);
    if (!enabled) {
      this.logger.log(`[skip] flag ${AUTO_RENEW_FLAG} desligada`);
      return null;
    }
    try {
      return await this.renewer.renewAll();
    } catch (err) {
      this.logger.error('renewAll falhou', (err as Error).stack);
      return null;
    }
  }
}
