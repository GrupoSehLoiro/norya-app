/**
 * CON-01 · TwitchConduitService.
 *
 * Twitch EventSub Conduits permite ter uma única transport handler (websocket
 * ou webhook) que agrega todas as subscriptions de todos os canais — em vez de
 * uma conexão por canal. O conduit é singleton por aplicação.
 *
 * Responsabilidades:
 *  - ensureConduit() idempotente: cria 1x e reutiliza nas chamadas seguintes
 *  - assignShards() atribui shards (websocket session_id ou webhook URL+secret)
 *  - deleteConduit() pra teardown / reset
 *
 * Auth via TwitchHelixService.getAppAccessToken (CON-* exige client_credentials,
 * não OAuth de usuário — o conduit é da aplicação, não de um streamer).
 *
 * Persistência: collection `twitch_conduit_state`, _id='singleton' (ver
 * TwitchConduitStatePersistence).
 *
 * Idempotência:
 *  - se já existe state local + Helix confirma → retorna cache
 *  - se existe state local mas Helix devolveu 404 → recria
 *  - se nada existe → cria do zero
 *  - 409 'conduit already exists' no POST trata como sucesso (race com outro boot)
 */
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import { TwitchHelixService } from '../twitch-irc/twitch-helix.service';
import {
  TWITCH_CONDUIT_SINGLETON_ID,
  TwitchConduitStatePersistence,
} from '../../persistence/mongoose/schemas/twitch-conduit-state.schema';

const HELIX_BASE = 'https://api.twitch.tv/helix';

export interface ConduitState {
  conduitId: string;
  shardCount: number;
}

export type ConduitShardTransport =
  | { method: 'websocket'; session_id: string }
  | { method: 'webhook'; callback: string; secret: string };

export interface ConduitShardAssignment {
  id: string;
  transport: ConduitShardTransport;
}

interface HelixConduit {
  id: string;
  shard_count: number;
}

@Injectable()
export class TwitchConduitService {
  private readonly logger = new Logger(TwitchConduitService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly helix: TwitchHelixService,
    private readonly clientId: string,
    private readonly model: Model<TwitchConduitStatePersistence>,
    /** Shard count inicial quando o conduit não existe ainda. */
    private readonly defaultShardCount: number = 1,
  ) {
    this.http = axios.create({ baseURL: HELIX_BASE, timeout: 10_000 });
  }

  /**
   * Devolve o conduit ativo, criando se necessário. Idempotente.
   * Após retorno, o documento singleton em Mongo está consistente com o que a
   * Helix conhece.
   */
  async ensureConduit(): Promise<ConduitState> {
    const persisted = await this.model.findById(TWITCH_CONDUIT_SINGLETON_ID).lean();

    if (persisted) {
      const stillExists = await this._findRemoteConduit(persisted.conduitId);
      if (stillExists) {
        return { conduitId: persisted.conduitId, shardCount: stillExists.shard_count };
      }
      this.logger.warn(`Conduit ${persisted.conduitId} sumiu do lado da Twitch — recriando`);
    }

    // Tenta primeiro descobrir um conduit pré-existente (outro boot pode ter
    // criado entre nosso findById e o POST).
    const remoteList = await this._listRemoteConduits();
    if (remoteList.length > 0) {
      const head = remoteList[0]!;
      await this._upsertState(head);
      return { conduitId: head.id, shardCount: head.shard_count };
    }

    const created = await this._createRemoteConduit(this.defaultShardCount);
    await this._upsertState(created);
    return { conduitId: created.id, shardCount: created.shard_count };
  }

  /**
   * Atribui shards ao conduit via PATCH /eventsub/conduits/shards.
   * `shards.length` deve ser <= shardCount; cada shard deve ter um id ('0'..'N-1').
   */
  async assignShards(conduitId: string, shards: ConduitShardAssignment[]): Promise<void> {
    if (shards.length === 0) {
      throw new Error('assignShards: lista de shards vazia');
    }

    const token = await this.helix.getAppAccessToken();
    await this.http.patch(
      '/eventsub/conduits/shards',
      { conduit_id: conduitId, shards },
      {
        headers: {
          'Client-Id': this.clientId,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
  }

  /** Apaga o conduit no Helix e o estado local. Reset total (cuidado em prod). */
  async deleteConduit(conduitId: string): Promise<void> {
    const token = await this.helix.getAppAccessToken();
    try {
      await this.http.delete('/eventsub/conduits', {
        params: { id: conduitId },
        headers: {
          'Client-Id': this.clientId,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      const ax = err as AxiosError;
      if (ax.response?.status !== 404) throw err;
      // 404 = já sumiu — segue limpando estado local
    }
    await this.model.deleteOne({ _id: TWITCH_CONDUIT_SINGLETON_ID });
  }

  // ─── helpers privados ────────────────────────────────────────────────────

  private async _upsertState(c: HelixConduit): Promise<void> {
    await this.model.updateOne(
      { _id: TWITCH_CONDUIT_SINGLETON_ID },
      {
        $set: {
          _id: TWITCH_CONDUIT_SINGLETON_ID,
          conduitId: c.id,
          shardCount: c.shard_count,
        },
      },
      { upsert: true },
    );
  }

  private async _listRemoteConduits(): Promise<HelixConduit[]> {
    const token = await this.helix.getAppAccessToken();
    const resp = await this.http.get<{ data: HelixConduit[] }>('/eventsub/conduits', {
      headers: {
        'Client-Id': this.clientId,
        Authorization: `Bearer ${token}`,
      },
    });
    return resp.data?.data ?? [];
  }

  private async _findRemoteConduit(conduitId: string): Promise<HelixConduit | null> {
    const list = await this._listRemoteConduits();
    return list.find((c) => c.id === conduitId) ?? null;
  }

  private async _createRemoteConduit(shardCount: number): Promise<HelixConduit> {
    const token = await this.helix.getAppAccessToken();
    try {
      const resp = await this.http.post<{ data: HelixConduit[] }>(
        '/eventsub/conduits',
        { shard_count: shardCount },
        {
          headers: {
            'Client-Id': this.clientId,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const created = resp.data?.data?.[0];
      if (!created) throw new Error('Conduit POST não devolveu data[]');
      return created;
    } catch (err) {
      const ax = err as AxiosError;
      // 409: outro processo criou no meio do caminho — releu lista.
      if (ax.response?.status === 409) {
        const list = await this._listRemoteConduits();
        if (list.length > 0) return list[0]!;
      }
      throw err;
    }
  }
}
