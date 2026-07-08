import { Controller, Get } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { Public } from '../identity/auth/decorators/public.decorator';

@Controller('moderation')
export class ModerationController {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly service: ModerationService) {}

  @Public()
  @Get('ping')
  ping(): { context: string; status: string } {
    return { context: 'moderation', status: 'alive' };
  }
}
