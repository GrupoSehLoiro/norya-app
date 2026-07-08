import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_BRAND_REPOSITORY,
  type ChannelBrand,
  type ChannelBrandRepository,
} from '@sehloro/domain';

@Injectable()
export class BrandService {
  constructor(
    @Inject(CHANNEL_BRAND_REPOSITORY)
    private readonly repo: ChannelBrandRepository,
  ) {}

  list(channelId: string): Promise<ChannelBrand[]> {
    return this.repo.listByChannel(channelId);
  }

  create(
    channelId: string,
    name: string,
    aliases?: string[],
    regex?: string | null,
  ): Promise<ChannelBrand> {
    return this.repo.create({ channelId, name, aliases, regex });
  }

  delete(id: string): Promise<void> {
    return this.repo.delete(id);
  }
}
