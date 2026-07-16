/**
 * ChannelLinkBackfill — vincula, no boot da API, canais que fizeram OAuth
 * antes do auto-link existir (têm `ownerId` mas não `creatorId`/`workspaceId`)
 * e por isso não apareciam em /api/v2/channels nem no picker "Canal ativo".
 *
 * Idempotente: só olha canais órfãos; quem já tem vínculo não é tocado.
 * Conservador: só vincula quando a resolução é inequívoca — dono com
 * exatamente 1 membership ativa E workspace com exatamente 1 creator
 * (regra do CreatorService.autoLinkIntegration). Ambiguidade → skip com log;
 * a UI "Canais aguardando vínculo" cobre o resto.
 *
 * Erro aqui nunca derruba o boot.
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  MEMBERSHIP_REPOSITORY,
  type ChannelRepository,
  type MembershipRepository,
} from '@sehloro/domain';
import { CreatorService } from './creator.service';

@Injectable()
export class ChannelLinkBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChannelLinkBackfill.name);

  constructor(
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly memberships: MembershipRepository,
    private readonly creators: CreatorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`Backfill de vínculo falhou (boot segue): ${(err as Error).message}`);
    }
  }

  private async run(): Promise<void> {
    const orphans = await this.channels.findUnlinkedOwned();
    if (orphans.length === 0) return;
    this.logger.log(`${orphans.length} canal(is) com OAuth mas sem creator — tentando vincular`);

    for (const ch of orphans) {
      const ownerId = ch.getOwnerId();
      if (!ownerId) continue;
      const active = (await this.memberships.findByUserId(ownerId)).filter(
        (m) => m.getStatus() === 'active',
      );
      const only = active.length === 1 ? active[0] : undefined;
      if (!only) {
        this.logger.warn(
          `skip channel=${ch.getName()} owner=${ownerId}: ${active.length} memberships ativas (esperado 1)`,
        );
        continue;
      }
      try {
        const result = await this.creators.autoLinkIntegration(
          only.getWorkspaceId(),
          ownerId,
          ch.getId(),
        );
        if (result === 'linked') {
          this.logger.log(`linked channel=${ch.getName()} ws=${only.getWorkspaceId()}`);
        } else {
          this.logger.warn(`skip channel=${ch.getName()}: ${result}`);
        }
      } catch (err) {
        this.logger.warn(`skip channel=${ch.getName()}: ${(err as Error).message}`);
      }
    }
  }
}
