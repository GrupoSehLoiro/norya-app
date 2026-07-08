/**
 * CreatorController — CRUD do Creator + perfil, escopado ao workspace ativo.
 *
 * Leituras: qualquer membro (JWT). Mutações: `@RequireWsRole('manager')`.
 * O `workspaceId` vem SEMPRE do token (`activeWorkspaceId`), nunca do body.
 */
import { Body, Controller, ForbiddenException, Get, Param, Post, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../identity/auth/decorators/current-user.decorator';
import { RequireWsRole } from '../identity/auth/decorators/require-ws-role.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreatorService, CreatorView, ProfileView } from './creator.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('v2/creators')
export class CreatorController {
  constructor(private readonly creators: CreatorService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<CreatorView[]> {
    return this.creators.listByWorkspace(wsId(user));
  }

  @Post()
  @RequireWsRole('manager')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCreatorDto)) dto: CreateCreatorDto,
  ): Promise<CreatorView> {
    return this.creators.create(wsId(user), dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<CreatorView> {
    return this.creators.getOne(id, wsId(user));
  }

  @Get(':id/profile')
  getProfile(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ProfileView> {
    return this.creators.getProfile(id, wsId(user));
  }

  @Put(':id/profile')
  @RequireWsRole('manager')
  upsertProfile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProfileDto)) dto: UpdateProfileDto,
  ): Promise<ProfileView> {
    return this.creators.upsertProfile(id, wsId(user), dto);
  }
}

/** Extrai o workspace ativo do token ou falha com 403. */
function wsId(user: AuthUser): string {
  if (!user.activeWorkspaceId) {
    throw new ForbiddenException({
      message: 'Sem workspace ativo',
      code: 'NO_ACTIVE_WORKSPACE',
    });
  }
  return user.activeWorkspaceId;
}
