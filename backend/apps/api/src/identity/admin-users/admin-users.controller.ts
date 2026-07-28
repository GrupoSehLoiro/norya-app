/**
 * Gestão de acesso — /api/v2/admin/users (SOMENTE role=admin).
 *
 *   GET    /api/v2/admin/users            lista usuários
 *   POST   /api/v2/admin/users            cria usuário com role (inclusive admin)
 *   PATCH  /api/v2/admin/users/:id/role   troca papel (nunca o próprio)
 *   DELETE /api/v2/admin/users/:id        apaga usuário + TUDO dele (nunca o próprio)
 *
 * Atrás do JwtAuthGuard global; o check de role segue o padrão inline do
 * codebase (ver FeatureFlagsController).
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminUsersService } from './admin-users.service';

const CreateUserDto = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'senha precisa ter no mínimo 8 caracteres'),
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(['admin', 'moderator', 'user']),
});
type CreateUserDto = z.infer<typeof CreateUserDto>;

const ChangeRoleDto = z.object({
  role: z.enum(['admin', 'moderator', 'user']),
});
type ChangeRoleDto = z.infer<typeof ChangeRoleDto>;

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

@Controller('v2/admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    this._assertAdmin(user);
    return this.service.list();
  }

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateUserDto)) dto: CreateUserDto,
  ) {
    this._assertAdmin(user);
    return this.service.createUser(dto);
  }

  @Patch(':id/role')
  async changeRole(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeRoleDto)) dto: ChangeRoleDto,
  ) {
    this._assertAdmin(user);
    return this.service.changeRole({
      targetUserId: id,
      role: dto.role,
      actingUserId: user.sub,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    this._assertAdmin(user);
    await this.service.deleteUser({ targetUserId: id, actingUserId: user.sub });
  }

  private _assertAdmin(user: JwtPayload): void {
    if (user.role !== 'admin') throw new ForbiddenException();
  }
}
