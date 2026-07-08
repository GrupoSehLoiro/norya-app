/**
 * Contract (port) do repositório de Channel.
 *
 * Ver observações em identity/user.repository.port.ts — mesma arquitetura.
 */
import { Channel, ChannelPlatform } from './channel.entity';

export interface ChannelFilterOptions {
  platform?: ChannelPlatform;
  active?: boolean;
  ownerId?: string;
  /** Escopo de tenant — filtra integrações de um workspace. */
  workspaceId?: string;
  page?: number;
  pageSize?: number;
}

export interface ChannelPage {
  channels: Channel[];
  total: number;
}

export interface ChannelRepository {
  findById(id: string): Promise<Channel | null>;
  findByName(name: string): Promise<Channel | null>;
  findAllActive(): Promise<Channel[]>;
  findMany(filters: ChannelFilterOptions): Promise<ChannelPage>;
  /** Quantas integrações (canais de plataforma) pertencem a um Creator. */
  countByCreatorId(creatorId: string): Promise<number>;
  /** Integrações de um Creator. */
  findByCreatorId(creatorId: string): Promise<Channel[]>;
  /** Canais do dono ainda sem Creator vinculado (para o onboarding linkar). */
  findUnlinkedByOwner(ownerId: string): Promise<Channel[]>;
  save(channel: Channel): Promise<Channel>;
  delete(id: string): Promise<void>;
}

export const CHANNEL_REPOSITORY = Symbol('ChannelRepository');
