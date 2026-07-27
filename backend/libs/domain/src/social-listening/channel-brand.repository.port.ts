import type { ChannelBrand } from './channel-brand.entity';

export interface ChannelBrandRepository {
  create(input: {
    creatorId: string;
    channelId?: string | null;
    name: string;
    aliases?: string[];
    regex?: string | null;
  }): Promise<ChannelBrand>;

  delete(id: string): Promise<void>;

  findById(id: string): Promise<ChannelBrand | null>;

  /**
   * Allowlist do criador — eixo principal. Substitui `listByChannel`: a marca é
   * individual do creator, não do canal (evita vazamento entre usuários que
   * reaproveitam a mesma conta de plataforma).
   */
  listByCreator(creatorId: string): Promise<ChannelBrand[]>;
}

export const CHANNEL_BRAND_REPOSITORY = Symbol('CHANNEL_BRAND_REPOSITORY');
