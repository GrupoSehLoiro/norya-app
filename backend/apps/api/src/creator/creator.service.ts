/**
 * CreatorService — CRUD do Creator (o "canal") + CreatorProfile, escopado ao
 * workspace ativo. Aplica limites de plano via EntitlementsService.
 *
 * Autorização de tenant: toda operação valida que o creator pertence ao
 * `workspaceId` ativo (do JWT) — nunca confia em id solto.
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  Channel,
  ChannelRepository,
  CREATOR_PROFILE_REPOSITORY,
  CREATOR_REPOSITORY,
  Creator,
  CreatorProfile,
  CreatorProfileRepository,
  CreatorRepository,
} from '@sehloro/domain';
import { EntitlementsService } from '../identity/billing/entitlements.service';
import type { CreateCreatorDto } from './dto/create-creator.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';

export interface CreatorView {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: string;
  profileComplete: boolean;
  createdAt: Date;
}

export interface ProfileView {
  creatorId: string;
  niche: string;
  category: string;
  subcategory: string;
  genre: string;
  audience: Record<string, unknown>;
  tags: string[];
  complete: boolean;
}

export interface IntegrationView {
  id: string;
  platform: string;
  name: string;
  displayName: string | null;
  externalId: string | null;
  active: boolean;
  creatorId: string | null;
}

@Injectable()
export class CreatorService {
  constructor(
    @Inject(CREATOR_REPOSITORY)
    private readonly creatorRepo: CreatorRepository,
    @Inject(CREATOR_PROFILE_REPOSITORY)
    private readonly profileRepo: CreatorProfileRepository,
    @Inject(CHANNEL_REPOSITORY)
    private readonly channelRepo: ChannelRepository,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(workspaceId: string, dto: CreateCreatorDto): Promise<CreatorView> {
    await this.entitlements.assertCanAddCreator(workspaceId);
    const creator = await this.creatorRepo.save(
      Creator.create({ workspaceId, name: dto.name, slug: dto.slug }),
    );
    return this.toView(creator, false);
  }

  async listByWorkspace(workspaceId: string): Promise<CreatorView[]> {
    const creators = await this.creatorRepo.findByWorkspaceId(workspaceId);
    const views: CreatorView[] = [];
    for (const c of creators) {
      const profile = await this.profileRepo.findByCreatorId(c.getId());
      views.push(this.toView(c, profile?.isComplete() ?? false));
    }
    return views;
  }

  async getOne(id: string, workspaceId: string): Promise<CreatorView> {
    const creator = await this.requireCreator(id, workspaceId);
    const profile = await this.profileRepo.findByCreatorId(id);
    return this.toView(creator, profile?.isComplete() ?? false);
  }

  async getProfile(id: string, workspaceId: string): Promise<ProfileView> {
    await this.requireCreator(id, workspaceId);
    const profile =
      (await this.profileRepo.findByCreatorId(id)) ?? CreatorProfile.create({ creatorId: id });
    return this.profileView(profile);
  }

  async upsertProfile(
    id: string,
    workspaceId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileView> {
    await this.requireCreator(id, workspaceId);
    const profile =
      (await this.profileRepo.findByCreatorId(id)) ?? CreatorProfile.create({ creatorId: id });
    profile.update(dto);
    // Consideramos o perfil "completo" quando a categoria está preenchida —
    // o mínimo para a IA ter contexto de nicho.
    if (dto.category && dto.category.trim().length > 0) {
      profile.markComplete();
    }
    const saved = await this.profileRepo.save(profile);
    return this.profileView(saved);
  }

  // ── Integrações (canais de plataforma vinculados ao creator) ──────────

  /** Canais do usuário ainda sem creator vinculado (para o onboarding linkar). */
  async listUnlinkedForUser(userId: string): Promise<IntegrationView[]> {
    const channels = await this.channelRepo.findUnlinkedByOwner(userId);
    return channels.map((c) => this.integrationView(c));
  }

  /** Integrações vinculadas a um creator. */
  async listIntegrations(id: string, workspaceId: string): Promise<IntegrationView[]> {
    await this.requireCreator(id, workspaceId);
    const channels = await this.channelRepo.findByCreatorId(id);
    return channels.map((c) => this.integrationView(c));
  }

  /**
   * Vincula um canal (já criado via OAuth, com ownerId = usuário) a um creator.
   * Valida posse (o canal é do usuário), tenant e limite de plano.
   */
  async linkIntegration(
    id: string,
    workspaceId: string,
    userId: string,
    channelId: string,
  ): Promise<IntegrationView> {
    await this.requireCreator(id, workspaceId);
    const channel = await this.channelRepo.findById(channelId);
    if (!channel) {
      throw new NotFoundException({ message: 'Integração não encontrada' });
    }
    if (channel.getOwnerId() && channel.getOwnerId() !== userId) {
      throw new ForbiddenException({
        message: 'Integração pertence a outro usuário',
        code: 'NOT_OWNER',
      });
    }
    // Idempotente: se já está vinculada a este creator, retorna como está.
    if (channel.getCreatorId() === id) {
      return this.integrationView(channel);
    }
    await this.entitlements.assertCanAddIntegration(workspaceId, id);
    channel.linkToCreator(id, workspaceId);
    const saved = await this.channelRepo.save(channel);
    return this.integrationView(saved);
  }

  /** Garante que o creator existe E pertence ao workspace ativo. */
  private async requireCreator(id: string, workspaceId: string): Promise<Creator> {
    const creator = await this.creatorRepo.findById(id);
    if (!creator) {
      throw new NotFoundException({ message: 'Creator não encontrado' });
    }
    if (creator.getWorkspaceId() !== workspaceId) {
      throw new ForbiddenException({
        message: 'Creator pertence a outro workspace',
        code: 'CROSS_TENANT',
      });
    }
    return creator;
  }

  private toView(creator: Creator, profileComplete: boolean): CreatorView {
    return {
      id: creator.getId(),
      workspaceId: creator.getWorkspaceId(),
      name: creator.getName(),
      slug: creator.getSlug(),
      status: creator.getStatus(),
      profileComplete,
      createdAt: creator.getCreatedAt(),
    };
  }

  private integrationView(channel: Channel): IntegrationView {
    return {
      id: channel.getId(),
      platform: channel.getPlatform(),
      name: channel.getName(),
      displayName: channel.getDisplayName() ?? null,
      externalId: channel.getExternalId() ?? null,
      active: channel.isActive(),
      creatorId: channel.getCreatorId() ?? null,
    };
  }

  private profileView(profile: CreatorProfile): ProfileView {
    const p = profile.toPersistence();
    return {
      creatorId: p.creatorId,
      niche: p.niche,
      category: p.category,
      subcategory: p.subcategory,
      genre: p.genre,
      audience: p.audience as Record<string, unknown>,
      tags: p.tags,
      complete: profile.isComplete(),
    };
  }
}
