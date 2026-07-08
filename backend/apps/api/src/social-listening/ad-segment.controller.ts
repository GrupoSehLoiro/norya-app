import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { AdSegmentService } from './ad-segment.service';

const StartSchema = z.object({
  channelId: z.string().min(1),
  durationSec: z.number().int().positive().max(3600).optional(),
  sessionId: z.string().nullable().optional(),
});
const StopSchema = z.object({
  channelId: z.string().min(1),
});

interface JwtPayload {
  userId: string;
  username: string;
  email: string;
  role: string;
}

@Controller('v2/social-listening/ad')
export class AdSegmentController {
  constructor(private readonly service: AdSegmentService) {}

  @Post('start')
  async start(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    this._assertAdminOrMod(user);
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }
    const seg = await this.service.startManual(
      parsed.data.channelId,
      parsed.data.durationSec,
      parsed.data.sessionId ?? null,
    );
    return { ok: true, segment: seg };
  }

  @Post('stop')
  async stop(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    this._assertAdminOrMod(user);
    const parsed = StopSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.message);
    }
    const seg = await this.service.stop(parsed.data.channelId);
    return { ok: true, segment: seg };
  }

  @Get('active')
  async active(@Query('channelId') channelId: string) {
    if (!channelId) throw new BadRequestException('channelId obrigatório');
    const status = await this.service.getStatus(channelId);
    return status;
  }

  private _assertAdminOrMod(user: JwtPayload): void {
    if (user.role !== 'admin' && user.role !== 'mod') {
      throw new ForbiddenException('Apenas admin/mod podem alterar AD.');
    }
  }
}
