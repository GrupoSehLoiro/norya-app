/**
 * FF-02 · FeatureFlagsSeedService.
 *
 * Idempotente: upsert em onApplicationBootstrap.
 * Garante que todas as flags referenciadas em código existem no Mongo com
 * valores default corretos mesmo em DB vazio (dev, staging, prod fresh).
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';

interface FlagSeed {
  key: string;
  defaultValue: boolean;
  description: string;
}

const FLAG_SEEDS: FlagSeed[] = [
  {
    key: 'ingestion.twitch.conduit',
    defaultValue: false,
    description:
      'Usa Twitch EventSub Conduit (WebSocket) em vez do IRC legado tmi.js. Opt-in por canal.',
  },
  {
    key: 'ingestion.kick.enabled',
    defaultValue: false,
    description:
      'Habilita ingestão de chat via Kick Pusher por canal. Requer OAuth Kick configurado.',
  },
  {
    key: 'ai.socialListening.enabled',
    defaultValue: false,
    description:
      'Liga pipeline IA (cascade Haiku→Sonnet) para análise de sentimento e insights ao vivo.',
  },
  {
    key: 'peaks.detection.enabled',
    defaultValue: true,
    description:
      'Habilita detecção de picos de viewerCount e taxa de chat usando baseline de 14 dias.',
  },
  {
    key: 'reports.oneClick.enabled',
    defaultValue: true,
    description: 'Exportação de relatório PDF de sessão em um clique via Puppeteer.',
  },
  {
    key: 'reconciler.enabled',
    defaultValue: true,
    description:
      'Loop de reconciliação do OrchestratorService (15 s). Desabilitar em dev para evitar spawns inesperados.',
  },
  {
    key: 'twitch.subscription.autoRenew',
    defaultValue: true,
    description:
      'Re-cria automaticamente subscriptions EventSub com status diferente de enabled (cron diário 04:00).',
  },
  {
    key: 'monitoring.autoStart',
    defaultValue: true,
    description:
      'Abre/fecha LiveSession automaticamente quando o worker recebe stream.online/offline via EventSub.',
  },
];

@Injectable()
export class FeatureFlagsSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeatureFlagsSeedService.name);

  constructor(private readonly flagsService: FeatureFlagsService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const seed of FLAG_SEEDS) {
      try {
        await this.flagsService.upsert(
          seed.key,
          { defaultValue: seed.defaultValue, description: seed.description },
          'system:seed',
        );
      } catch (err) {
        this.logger.error(`Falha ao seeder flag "${seed.key}"`, err);
      }
    }
    this.logger.log(`${FLAG_SEEDS.length} feature flags seedadas`);
  }
}
