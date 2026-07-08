/**
 * OnboardingController — taxonomia + status + conclusão do onboarding.
 *
 * Tudo escopado ao workspace ativo do token. `complete` exige perfil completo
 * + ≥1 integração (ver OnboardingService).
 */
import { Controller, ForbiddenException, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../identity/auth/decorators/current-user.decorator';
import { OnboardingService, OnboardingStatus } from './onboarding.service';
import { Taxonomy } from './taxonomy';

@Controller('v2/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('taxonomy')
  taxonomy(): Taxonomy {
    return this.onboarding.getTaxonomy();
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser): Promise<OnboardingStatus> {
    return this.onboarding.evaluate(user.sub, wsId(user));
  }

  @Post('complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser): Promise<OnboardingStatus> {
    return this.onboarding.complete(user.sub, wsId(user));
  }
}

function wsId(user: AuthUser): string {
  if (!user.activeWorkspaceId) {
    throw new ForbiddenException({
      message: 'Sem workspace ativo',
      code: 'NO_ACTIVE_WORKSPACE',
    });
  }
  return user.activeWorkspaceId;
}
