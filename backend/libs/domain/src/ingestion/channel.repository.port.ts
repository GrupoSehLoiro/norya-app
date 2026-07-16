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
  /**
   * Canais que o dono pode "reivindicar" no onboarding do workspace atual:
   * ainda sem Creator vinculado OU vinculados a um Creator de OUTRO workspace
   * (ex.: o mesmo streamer foi reconectado por uma conta nova). Estes últimos
   * ficam órfãos pro workspace atual, então o wizard precisa poder revinculá-los.
   */
  findClaimableByOwner(ownerId: string, workspaceId: string): Promise<Channel[]>;
  /**
   * Canais com dono (OAuth feito) mas sem Creator vinculado — órfãos de
   * quando o OAuth ainda não auto-vinculava. Consumido pelo backfill de boot.
   */
  findUnlinkedOwned(): Promise<Channel[]>;
  save(channel: Channel): Promise<Channel>;
  delete(id: string): Promise<void>;
}

export const CHANNEL_REPOSITORY = Symbol('ChannelRepository');
