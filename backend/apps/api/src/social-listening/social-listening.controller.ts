import { Controller, Get } from '@nestjs/common';
import { SocialListeningService } from './social-listening.service';
import { Public } from '../identity/auth/decorators/public.decorator';

/**
 * Nota: controller path usa hífen (`social-listening`) para consistência com
 * o resto das rotas do produto. Com o prefixo global `/api`, a URL final é
 * `GET /api/social-listening/ping`.
 */
@Controller('social-listening')
export class SocialListeningController {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly service: SocialListeningService) {}

  @Public()
  @Get('ping')
  ping(): { context: string; status: string } {
    return { context: 'social-listening', status: 'alive' };
  }
}
