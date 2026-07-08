/**
 * FF-01 · FeatureFlagsController — admin CRUD /api/v2/feature-flags.
 */
import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { FeatureFlagsService } from './feature-flags.service';

const PatchFlagSchema = z.object({
  defaultValue: z.boolean().optional(),
  description: z.string().optional(),
  rules: z
    .array(
      z.object({
        type: z.enum(['channel', 'user', 'percentage']),
        ids: z.array(z.string()).optional(),
        percentage: z.number().min(0).max(100).optional(),
        value: z.boolean(),
      }),
    )
    .optional(),
});

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

@Controller('v2/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  @Get()
  async findAll(@CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException();
    return this.service.findAll();
  }

  @Get(':key')
  async findOne(@Param('key') key: string, @CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException();
    return this.service.findByKey(key);
  }

  @Patch(':key')
  async update(@Param('key') key: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    if (user.role !== 'admin') throw new ForbiddenException();
    const parsed = PatchFlagSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.service.upsert(key, parsed.data, user.username);
  }
}
