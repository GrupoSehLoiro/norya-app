import type { ChannelBrand } from './channel-brand.entity';

export interface ChannelBrandRepository {
  create(input: {
    channelId: string;
    name: string;
    aliases?: string[];
    regex?: string | null;
  }): Promise<ChannelBrand>;

  delete(id: string): Promise<void>;

  listByChannel(channelId: string): Promise<ChannelBrand[]>;
}

export const CHANNEL_BRAND_REPOSITORY = Symbol('CHANNEL_BRAND_REPOSITORY');
