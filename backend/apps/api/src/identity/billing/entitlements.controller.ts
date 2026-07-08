/**
 * EntitlementsController — expõe os entitlements (plano + uso vs. limites) do
 * workspace ativo, para o console mostrar uso e CTAs de upgrade.
 */
import { Controller, ForbiddenException, Get } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { Entitlements, EntitlementsService } from './entitlements.service';

@Controller('v2/entitlements')
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<Entitlements> {
    if (!user.activeWorkspaceId) {
      throw new ForbiddenException({
        message: 'Sem workspace ativo',
        code: 'NO_ACTIVE_WORKSPACE',
      });
    }
    return this.entitlements.getEntitlements(user.activeWorkspaceId);
  }
}
