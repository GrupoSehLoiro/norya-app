import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHANNEL_BRAND_REPOSITORY,
  CHANNEL_REPOSITORY,
  CREATOR_REPOSITORY,
  type ChannelBrand,
  type ChannelBrandRepository,
  type ChannelRepository,
  type CreatorRepository,
} from '@sehloro/domain';

/**
 * BrandService — allowlist de marcas escopada por CREATOR.
 *
 * A marca é individual do criador, não do canal: a mesma conta de plataforma
 * pode ser reaproveitada por donos diferentes, então escopar por `channelId`
 * vazava marcas entre usuários. Toda operação resolve um `creatorId` (direto,
 * ou derivado do canal) e valida que ele pertence ao workspace do chamador.
 */
@Injectable()
export class BrandService {
  constructor(
    @Inject(CHANNEL_BRAND_REPOSITORY)
    private readonly repo: ChannelBrandRepository,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channels: ChannelRepository,
    @Inject(CREATOR_REPOSITORY)
    private readonly creators: CreatorRepository,
  ) {}

  async list(scope: BrandScope, workspaceId?: string): Promise<ChannelBrand[]> {
    const creatorId = await this.resolveCreatorId(scope, workspaceId);
    return this.repo.listByCreator(creatorId);
  }

  async create(
    scope: BrandScope,
    name: string,
    aliases: string[] | undefined,
    regex: string | null,
    workspaceId?: string,
  ): Promise<ChannelBrand> {
    const creatorId = await this.resolveCreatorId(scope, workspaceId);
    return this.repo.create({
      creatorId,
      channelId: scope.channelId ?? null,
      name,
      aliases,
      regex,
    });
  }

  async delete(id: string, workspaceId?: string): Promise<void> {
    const brand = await this.repo.findById(id);
    if (!brand) throw new NotFoundException('Marca não encontrada');
    await this.assertCreatorInWorkspace(brand.creatorId, workspaceId);
    await this.repo.delete(id);
  }

  /**
   * Deriva o `creatorId` do escopo pedido e garante o isolamento de tenant.
   * Preferimos o `creatorId` explícito (onboarding); senão resolvemos pelo
   * `channelId` (dashboard opera sobre o canal selecionado, cujo dono é o
   * próprio usuário logado).
   */
  private async resolveCreatorId(scope: BrandScope, workspaceId?: string): Promise<string> {
    if (scope.creatorId) {
      await this.assertCreatorInWorkspace(scope.creatorId, workspaceId);
      return scope.creatorId;
    }
    if (scope.channelId) {
      const channel = await this.channels.findById(scope.channelId);
      if (!channel) throw new NotFoundException('Canal não encontrado');
      const creatorId = channel.getCreatorId();
      if (!creatorId) {
        throw new NotFoundException('Canal ainda não vinculado a um criador');
      }
      await this.assertCreatorInWorkspace(creatorId, workspaceId);
      return creatorId;
    }
    throw new NotFoundException('creatorId ou channelId obrigatório');
  }

  private async assertCreatorInWorkspace(creatorId: string, workspaceId?: string): Promise<void> {
    // Sem workspace no contexto (chamadas internas do pipeline) não há tenant a
    // validar — os consumidores internos já resolvem o creator do canal.
    if (!workspaceId) return;
    const creator = await this.creators.findById(creatorId);
    if (!creator || creator.getWorkspaceId() !== workspaceId) {
      throw new ForbiddenException('Criador fora do seu workspace');
    }
  }
}

export interface BrandScope {
  creatorId?: string;
  channelId?: string;
}
