import { Controller, Get } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { Public } from '../identity/auth/decorators/public.decorator';

@Controller('ingestion')
export class IngestionController {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly service: IngestionService) {}

  @Public()
  @Get('ping')
  ping(): { context: string; status: string } {
    return { context: 'ingestion', status: 'alive' };
  }
}
