/**
 * OnboardingService — conclui o onboarding do usuário no workspace ativo.
 *
 * Regra (decisão do produto): conclui quando existe pelo menos um Creator com
 * **perfil completo** (categoria preenchida) E **≥1 integração** conectada
 * (channel com `creatorId`). Marca `user.onboardingCompletedAt`.
 */
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  ChannelRepository,
  CREATOR_PROFILE_REPOSITORY,
  CREATOR_REPOSITORY,
  CreatorProfileRepository,
  CreatorRepository,
  USER_REPOSITORY,
  UserRepository,
} from '@sehloro/domain';
import { TAXONOMY, Taxonomy } from './taxonomy';

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  hasCreator: boolean;
  hasCompleteProfile: boolean;
  hasIntegration: boolean;
}

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(CREATOR_REPOSITORY)
    private readonly creatorRepo: CreatorRepository,
    @Inject(CREATOR_PROFILE_REPOSITORY)
    private readonly profileRepo: CreatorProfileRepository,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channelRepo: ChannelRepository,
  ) {}

  getTaxonomy(): Taxonomy {
    return TAXONOMY;
  }

  /** Avalia (sem persistir) se o onboarding pode ser concluído. */
  async evaluate(userId: string, workspaceId: string): Promise<OnboardingStatus> {
    const user = await this.userRepo.findById(userId);
    const creators = await this.creatorRepo.findByWorkspaceId(workspaceId);

    let hasCompleteProfile = false;
    let hasIntegration = false;
    for (const c of creators) {
      const profile = await this.profileRepo.findByCreatorId(c.getId());
      if (profile?.isComplete()) hasCompleteProfile = true;
      const integrations = await this.channelRepo.countByCreatorId(c.getId());
      if (integrations > 0) hasIntegration = true;
    }

    return {
      onboardingCompleted: user?.isOnboardingCompleted() ?? false,
      hasCreator: creators.length > 0,
      hasCompleteProfile,
      hasIntegration,
    };
  }

  /** Conclui o onboarding. Falha (409-ish) se os requisitos não forem atendidos. */
  async complete(userId: string, workspaceId: string): Promise<OnboardingStatus> {
    const status = await this.evaluate(userId, workspaceId);

    if (!status.hasCompleteProfile) {
      throw new ForbiddenException({
        message: 'Preencha o perfil do canal antes de concluir',
        code: 'PROFILE_INCOMPLETE',
      });
    }
    if (!status.hasIntegration) {
      throw new ForbiddenException({
        message: 'Conecte ao menos uma integração antes de concluir',
        code: 'NO_INTEGRATION',
      });
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ message: 'Usuário não encontrado' });
    }
    user.markOnboardingCompleted();
    await this.userRepo.save(user);

    return { ...status, onboardingCompleted: true };
  }
}
