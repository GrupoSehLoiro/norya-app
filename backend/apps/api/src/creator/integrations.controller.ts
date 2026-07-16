/**
 * IntegrationsController — vincula canais (criados via OAuth Twitch/Kick) a um
 * Creator durante o onboarding, e lista integrações.
 *
 * O OAuth existente (`/api/v2/auth/twitch|kick`) cria o canal com `ownerId` =
 * usuário. Aqui o wizard:
 *  - lista os canais do usuário ainda sem creator (`GET /unlinked`);
 *  - vincula um ao creator (`POST /link`).
 */
import { Body, Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../identity/auth/decorators/current-user.decorator';
import { RequireWsRole } from '../identity/auth/decorators/require-ws-role.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreatorService, IntegrationView } from './creator.service';

const LinkDto = z.object({
  creatorId: z.string().min(1),
  channelId: z.string().min(1),
});
type LinkDto = z.infer<typeof LinkDto>;

@Controller('v2/integrations')
export class IntegrationsController {
  constructor(private readonly creators: CreatorService) {}

  /** Canais do usuário ainda não vinculados a nenhum creator. */
  @Get('unlinked')
  unlinked(@CurrentUser() user: AuthUser): Promise<IntegrationView[]> {
    return this.creators.listUnlinkedForUser(user.sub, wsId(user));
  }

  /** Integrações de um creator. */
  @Get()
  byCreator(
    @CurrentUser() user: AuthUser,
    @Query('creatorId') creatorId: string,
  ): Promise<IntegrationView[]> {
    return this.creators.listIntegrations(creatorId, wsId(user));
  }

  @Post('link')
  @RequireWsRole('manager')
  link(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LinkDto)) dto: LinkDto,
  ): Promise<IntegrationView> {
    return this.creators.linkIntegration(dto.creatorId, wsId(user), user.sub, dto.channelId);
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
