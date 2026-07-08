/**
 * EntitlementsService — resolve o Plano do Workspace e checa limites.
 *
 * Sem cobrança real (Fase 1) — só a estrutura para o paywall futuro. Ver
 * `rbac/entitlements-plans.md`. Os `assert*` lançam 403 `PLAN_LIMIT` quando o
 * uso atual estoura o limite do plano. `-1` = ilimitado (`withinLimit`).
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  ChannelRepository,
  CREATOR_REPOSITORY,
  CreatorRepository,
  FeatureKey,
  Plan,
  WORKSPACE_REPOSITORY,
  WorkspaceRepository,
  getPlan,
  withinLimit,
} from '@sehloro/domain';

export interface Entitlements {
  plan: Plan;
  usage: { creators: number };
  limits: {
    maxCreators: number;
    maxIntegrationsPerCreator: number;
    maxBrands: number;
  };
  features: FeatureKey[];
}

@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(WORKSPACE_REPOSITORY)
    private readonly workspaceRepo: WorkspaceRepository,
    @Inject(CREATOR_REPOSITORY)
    private readonly creatorRepo: CreatorRepository,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channelRepo: ChannelRepository,
  ) {}

  async getPlan(workspaceId: string): Promise<Plan> {
    const ws = await this.workspaceRepo.findById(workspaceId);
    if (!ws) {
      throw new NotFoundException({ message: 'Workspace não encontrado' });
    }
    return getPlan(ws.getPlanKey());
  }

  async getEntitlements(workspaceId: string): Promise<Entitlements> {
    const plan = await this.getPlan(workspaceId);
    const creators = await this.creatorRepo.countByWorkspaceId(workspaceId);
    return {
      plan,
      usage: { creators },
      limits: {
        maxCreators: plan.maxCreators,
        maxIntegrationsPerCreator: plan.maxIntegrationsPerCreator,
        maxBrands: plan.maxBrands,
      },
      features: plan.features,
    };
  }

  async hasFeature(workspaceId: string, feature: FeatureKey): Promise<boolean> {
    const plan = await this.getPlan(workspaceId);
    return plan.features.includes(feature);
  }

  async assertCanAddCreator(workspaceId: string): Promise<void> {
    const plan = await this.getPlan(workspaceId);
    const used = await this.creatorRepo.countByWorkspaceId(workspaceId);
    if (!withinLimit(used, plan.maxCreators)) {
      throw new ForbiddenException({
        message: `Plano ${plan.label} permite no máximo ${plan.maxCreators} canal(is)`,
        code: 'PLAN_LIMIT',
        limit: 'maxCreators',
      });
    }
  }

  async assertCanAddIntegration(workspaceId: string, creatorId: string): Promise<void> {
    const plan = await this.getPlan(workspaceId);
    const used = await this.channelRepo.countByCreatorId(creatorId);
    if (!withinLimit(used, plan.maxIntegrationsPerCreator)) {
      throw new ForbiddenException({
        message: `Plano ${plan.label} permite no máximo ${plan.maxIntegrationsPerCreator} integração(ões) por canal`,
        code: 'PLAN_LIMIT',
        limit: 'maxIntegrationsPerCreator',
      });
    }
  }
}
