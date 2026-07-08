import { Controller, Get } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { Public } from './auth/decorators/public.decorator';

@Controller('identity')
export class IdentityController {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly service: IdentityService) {}

  /**
   * Ping de liveness do contexto. Público — `@Public()` bypassa o
   * JwtAuthGuard global.
   */
  @Public()
  @Get('ping')
  ping(): { context: string; status: string } {
    return { context: 'identity', status: 'alive' };
  }
}
