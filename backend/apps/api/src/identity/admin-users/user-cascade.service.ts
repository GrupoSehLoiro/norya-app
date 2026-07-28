/**
 * UserCascadeService — apaga um usuário e TUDO que pertence a ele.
 *
 * Grafo real dos dados (ver schemas em @sehloro/infra):
 *   User → Workspace(ownerUserId) → Creator(workspaceId) →
 *     CreatorProfile / ChannelBrand → Channel(ownerId|creatorId|workspaceId) →
 *       ChannelOAuthToken / LiveSession / AdSegment / BatchMessages /
 *       WorkerState / TwitchEventSubSubscription / coleções legadas (por nome)
 *       + ClickHouse (chat_messages, batch_analysis, ad_segments por channel_id)
 *
 * Nada aqui é transacional (os repos não usam sessão Mongo) — a ordem é
 * folhas → raiz, então uma falha no meio deixa o User intacto e o delete
 * pode ser re-executado (todas as operações são idempotentes).
 *
 * Fica de fora, de propósito:
 *   - access_logs: trilha de auditoria com TTL próprio (14 dias);
 *   - assinaturas EventSub REMOTAS na Twitch: o doc local morre e o worker
 *     reconcilia/expira o lado Twitch (sem canal → sem renovação).
 */
import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  CHANNEL_OAUTH_TOKEN_REPOSITORY,
  CHANNEL_REPOSITORY,
  CREATOR_PROFILE_REPOSITORY,
  CREATOR_REPOSITORY,
  MEMBERSHIP_REPOSITORY,
  USER_REPOSITORY,
  WORKSPACE_REPOSITORY,
  type Channel,
  type ChannelOAuthTokenRepository,
  type ChannelRepository,
  type CreatorProfileRepository,
  type CreatorRepository,
  type MembershipRepository,
  type UserRepository,
  type WorkspaceRepository,
} from '@sehloro/domain';
import {
  AdSegmentSchemaName,
  BanSchemaName,
  BatchMessagesSchemaName,
  ChannelBrandSchemaName,
  ChatEmojiSchemaName,
  ClickHouseClient,
  EmailVerificationCodeSchemaName,
  LiveSessionSchemaName,
  MessageDeletedSchemaName,
  PollSchemaName,
  PredictionSchemaName,
  RefreshTokenSchemaName,
  TimeoutSchemaName,
  TwitchEventSubSubscriptionSchemaName,
  WorkerStateSchemaName,
} from '@sehloro/infra';

/** Tabelas ClickHouse escopadas por channel_id (ver infra/clickhouse/migrations). */
const CLICKHOUSE_TABLES = ['chat_messages', 'batch_analysis', 'ad_segments'] as const;

export interface CascadeResult {
  channels: number;
  creators: number;
  workspaces: number;
}

@Injectable()
export class UserCascadeService {
  private readonly logger = new Logger(UserCascadeService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: UserRepository,
    @Inject(WORKSPACE_REPOSITORY) private readonly workspaceRepo: WorkspaceRepository,
    @Inject(MEMBERSHIP_REPOSITORY) private readonly membershipRepo: MembershipRepository,
    @Inject(CREATOR_REPOSITORY) private readonly creatorRepo: CreatorRepository,
    @Inject(CREATOR_PROFILE_REPOSITORY) private readonly profileRepo: CreatorProfileRepository,
    @Inject(CHANNEL_REPOSITORY) private readonly channelRepo: ChannelRepository,
    @Inject(CHANNEL_OAUTH_TOKEN_REPOSITORY)
    private readonly tokenRepo: ChannelOAuthTokenRepository,
    @InjectModel(RefreshTokenSchemaName) private readonly refreshTokens: Model<unknown>,
    @InjectModel(EmailVerificationCodeSchemaName) private readonly emailCodes: Model<unknown>,
    @InjectModel(ChannelBrandSchemaName) private readonly channelBrands: Model<unknown>,
    @InjectModel(LiveSessionSchemaName) private readonly liveSessions: Model<unknown>,
    @InjectModel(AdSegmentSchemaName) private readonly adSegments: Model<unknown>,
    @InjectModel(BatchMessagesSchemaName) private readonly batchMessages: Model<unknown>,
    @InjectModel(WorkerStateSchemaName) private readonly workerStates: Model<unknown>,
    @InjectModel(TwitchEventSubSubscriptionSchemaName)
    private readonly eventsubSubs: Model<unknown>,
    @InjectModel(BanSchemaName) private readonly bans: Model<unknown>,
    @InjectModel(TimeoutSchemaName) private readonly timeouts: Model<unknown>,
    @InjectModel(MessageDeletedSchemaName) private readonly messageDeleteds: Model<unknown>,
    @InjectModel(PollSchemaName) private readonly polls: Model<unknown>,
    @InjectModel(PredictionSchemaName) private readonly predictions: Model<unknown>,
    @InjectModel(ChatEmojiSchemaName) private readonly chatEmojis: Model<unknown>,
    // Opcional para os testes de unidade; no app o módulo global de analytics provê.
    @Optional() private readonly clickhouse?: ClickHouseClient,
  ) {}

  /** Apaga o usuário e todo o grafo de dados dele. Idempotente e re-executável. */
  async deleteUserCascade(targetUserId: string): Promise<CascadeResult> {
    const user = await this.userRepo.findById(targetUserId);
    if (!user) throw new NotFoundException({ message: 'Usuário não encontrado' });

    // ── grafo do usuário ──────────────────────────────────────────────────
    const workspaces = await this.workspaceRepo.findByOwnerUserId(targetUserId);
    const creators = (
      await Promise.all(workspaces.map((w) => this.creatorRepo.findByWorkspaceId(w.getId())))
    ).flat();

    // Canais do usuário: por ownerId direto E via creators dos workspaces dele.
    const owned = await this.channelRepo.findMany({ ownerId: targetUserId, pageSize: 1000 });
    const viaCreator = (
      await Promise.all(creators.map((c) => this.channelRepo.findByCreatorId(c.getId())))
    ).flat();
    const channels = new Map<string, Channel>();
    for (const ch of [...owned.channels, ...viaCreator]) channels.set(ch.getId(), ch);

    // ── folhas → raiz ─────────────────────────────────────────────────────
    for (const ch of channels.values()) {
      await this._purgeChannel(ch);
      await this.channelRepo.delete(ch.getId());
    }

    for (const c of creators) {
      const profile = await this.profileRepo.findByCreatorId(c.getId());
      if (profile) await this.profileRepo.delete(profile.getId());
      await this.channelBrands.deleteMany({ creatorId: c.getId() });
      await this.creatorRepo.delete(c.getId());
    }

    for (const w of workspaces) {
      // Memberships de QUALQUER usuário nesses workspaces (o workspace morre).
      const members = await this.membershipRepo.findByWorkspaceId(w.getId());
      for (const m of members) await this.membershipRepo.delete(m.getId());
      await this.workspaceRepo.delete(w.getId());
    }
    // Memberships do usuário em workspaces de terceiros.
    for (const m of await this.membershipRepo.findByUserId(targetUserId)) {
      await this.membershipRepo.delete(m.getId());
    }

    await this.refreshTokens.deleteMany({ userId: targetUserId });
    await this.emailCodes.deleteMany({ userId: targetUserId });

    await this.userRepo.delete(targetUserId);

    const result: CascadeResult = {
      channels: channels.size,
      creators: creators.length,
      workspaces: workspaces.length,
    };
    this.logger.log(
      `Usuário ${user.getEmail()} apagado em cascata: ` +
        `${result.channels} canal(is), ${result.creators} creator(s), ${result.workspaces} workspace(s)`,
    );
    return result;
  }

  /** Apaga tokens OAuth + dados operacionais/analíticos de um canal. */
  private async _purgeChannel(ch: Channel): Promise<void> {
    const channelId = ch.getId();
    const name = ch.getName();

    for (const platform of ['twitch', 'kick'] as const) {
      const token = await this.tokenRepo.findByChannelId(channelId, platform);
      if (token) await this.tokenRepo.delete(token.getId());
    }

    await Promise.all([
      this.liveSessions.deleteMany({ channelId }),
      this.adSegments.deleteMany({ channelId }),
      this.batchMessages.deleteMany({ channelId }),
      this.workerStates.deleteMany({ channelId }),
      this.eventsubSubs.deleteMany({ channelId }),
      // Coleções legadas escopadas pelo NOME do canal.
      this.bans.deleteMany({ channel: name }),
      this.timeouts.deleteMany({ channel: name }),
      this.messageDeleteds.deleteMany({ channel: name }),
      this.polls.deleteMany({ channel: name }),
      this.predictions.deleteMany({ channel: name }),
      this.chatEmojis.deleteMany({ channel: name }),
    ]);

    // ClickHouse é melhor-esforço: indisponibilidade não pode abortar o
    // cascade (os dados lá são inertes sem o canal no Mongo).
    if (!this.clickhouse) return;
    const safeId = channelId.replace(/'/g, '');
    for (const table of CLICKHOUSE_TABLES) {
      try {
        await this.clickhouse.exec(`ALTER TABLE ${table} DELETE WHERE channel_id = '${safeId}'`);
      } catch (err) {
        this.logger.warn(
          `Purge ClickHouse falhou (${table}, channel=${channelId}): ${(err as Error).message}`,
        );
      }
    }
  }
}
