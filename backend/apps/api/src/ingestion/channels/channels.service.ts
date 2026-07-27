/**
 * ORC-02 · ChannelsService.
 *
 * Lógica de negócio para gestão de canais v2.
 *
 * Na criação (POST), resolve automaticamente `externalId` e `displayName`
 * via TwitchHelixService (platform=twitch) ou KickRestClient (platform=kick).
 *
 * Na deleção lógica (DELETE), emite evento para que o OrchestratorService
 * pare o worker correspondente (ChannelDeactivatedEvent futuro — por ora
 * chama o orchestrator diretamente).
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  CHANNEL_REPOSITORY,
  Channel,
  ChannelRepository,
  ChannelFilterOptions,
  ChannelPage,
  InvalidChannelError,
} from '@sehloro/domain';
import { TwitchHelixService, KickRestClient } from '@sehloro/infra';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @Inject(CHANNEL_REPOSITORY) private readonly channelRepo: ChannelRepository,
    private readonly helixService: TwitchHelixService,
    private readonly kickClient: KickRestClient,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async findMany(filters: ChannelFilterOptions): Promise<ChannelPage> {
    return this.channelRepo.findMany(filters);
  }

  async findById(id: string): Promise<Channel> {
    const channel = await this.channelRepo.findById(id);
    if (!channel) throw new NotFoundException(`Canal ${id} não encontrado`);
    return channel;
  }

  async create(dto: CreateChannelDto): Promise<Channel> {
    // Verifica duplicata por nome
    const existing = await this.channelRepo.findByName(dto.name);
    if (existing) throw new ConflictException(`Canal "${dto.name}" já existe`);

    let externalId: string | undefined;
    let displayName: string | undefined;
    let avatarUrl: string | undefined;

    if (dto.platform === 'twitch') {
      const user = await this.helixService.getUserByLogin(dto.name).catch(() => null);
      if (!user) {
        throw new BadRequestException(`Canal Twitch "${dto.name}" não encontrado via Helix`);
      }
      externalId = user.id;
      displayName = user.displayName;
      avatarUrl = user.profileImageUrl;
    } else if (dto.platform === 'kick') {
      const kickChannel = await this.kickClient.getChannel(dto.name).catch(() => null);
      if (!kickChannel) {
        throw new BadRequestException(`Canal Kick "${dto.name}" não encontrado via REST`);
      }
      externalId = String(kickChannel.id);
      displayName = kickChannel.slug;
    }

    let channel: Channel;
    try {
      channel = Channel.create({
        name: dto.name,
        platform: dto.platform,
        externalId,
        displayName,
        avatarUrl,
        ownerId: dto.ownerId,
        flags: dto.flags,
        active: true,
      });
    } catch (err) {
      if (err instanceof InvalidChannelError) throw new BadRequestException(err.message);
      throw err;
    }

    return this.channelRepo.save(channel);
  }

  async update(id: string, dto: UpdateChannelDto): Promise<Channel> {
    const existing = await this.findById(id);

    // Reconstitui com os campos atualizados — a entidade é imutável,
    // então criamos uma nova instância com toPersistence + reconstitute.
    const current = existing.toPersistence();
    const updated = Channel.reconstitute({
      id: current._id,
      name: current.channel,
      platform: current.platform,
      active: dto.active ?? current.active,
      createdAt: current.created_at,
      externalId: current.externalId,
      displayName: current.displayName,
      avatarUrl: current.profileImageUrl,
      ownerId: current.ownerId,
      flags: dto.flags !== undefined ? { ...current.flags, ...dto.flags } : current.flags,
    });

    const saved = await this.channelRepo.save(updated);

    // Canal desativado → para o worker
    if (dto.active === false && existing.isActive()) {
      this.orchestrator
        .stop(id)
        .catch((err: unknown) =>
          this.logger.error(`Falha ao parar worker ao desativar canal ${id}`, err),
        );
    }

    // Canal reativado → inicia worker
    if (dto.active === true && !existing.isActive()) {
      this.orchestrator
        .start(id)
        .catch((err: unknown) =>
          this.logger.error(`Falha ao iniciar worker ao reativar canal ${id}`, err),
        );
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const channel = await this.findById(id);

    if (channel.isActive()) {
      await this.orchestrator
        .stop(id)
        .catch((err: unknown) =>
          this.logger.error(`Falha ao parar worker antes de deletar canal ${id}`, err),
        );
    }

    await this.channelRepo.delete(id);
  }
}
