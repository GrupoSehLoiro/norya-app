/**
 * ORC-02 · ChannelsController — CRUD /api/v2/channels.
 *
 * Todos os endpoints requerem JWT (guard global). POST e DELETE exigem role admin.
 */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Channel, ChannelFilterOptions, ChannelPlatform } from '@sehloro/domain';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelSchema } from './dto/create-channel.dto';
import { UpdateChannelSchema } from './dto/update-channel.dto';

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  activeWorkspaceId?: string;
}

@Controller('v2/channels')
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

  @Get()
  async findMany(
    @CurrentUser() user: JwtPayload,
    @Query('platform') platform?: string,
    @Query('active') active?: string,
    @Query('ownerId') ownerId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filters: ChannelFilterOptions = {
      platform: platform as ChannelPlatform | undefined,
      active: active !== undefined ? active === 'true' : undefined,
      ownerId,
      // Escopo de tenant: usuário com workspace ativo só enxerga os canais
      // (integrações) do próprio workspace. Tokens legados sem workspace
      // (ex.: admin do legado) seguem sem escopo, vendo todos.
      workspaceId: user.activeWorkspaceId,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    };
    const result = await this.service.findMany(filters);
    return {
      channels: result.channels.map(serializeChannel),
      total: result.total,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const channel = await this.service.findById(id);
    return serializeChannel(channel);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException('Apenas admins podem criar canais');

    const parsed = CreateChannelSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const channel = await this.service.create(parsed.data);
    return serializeChannel(channel);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException('Apenas admins podem editar canais');

    const parsed = UpdateChannelSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const channel = await this.service.update(id, parsed.data);
    return serializeChannel(channel);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException('Apenas admins podem remover canais');
    await this.service.remove(id);
  }
}

function serializeChannel(c: Channel) {
  return {
    id: c.getId(),
    name: c.getName(),
    platform: c.getPlatform(),
    externalId: c.getExternalId(),
    displayName: c.getDisplayName(),
    ownerId: c.getOwnerId(),
    creatorId: c.getCreatorId(),
    workspaceId: c.getWorkspaceId(),
    flags: c.getFlags(),
    active: c.isActive(),
    createdAt: c.getCreatedAt(),
  };
}
