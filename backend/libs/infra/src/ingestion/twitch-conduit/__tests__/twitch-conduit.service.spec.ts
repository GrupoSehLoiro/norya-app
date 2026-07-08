jest.mock('axios');

import axios from 'axios';
import type { AxiosError, AxiosInstance } from 'axios';
import type { Model } from 'mongoose';
import { TwitchHelixService } from '../../twitch-irc/twitch-helix.service';
import { ConduitShardAssignment, TwitchConduitService } from '../twitch-conduit.service';
import type { TwitchConduitStatePersistence } from '../../../persistence/mongoose/schemas/twitch-conduit-state.schema';

const axiosMock = axios as jest.Mocked<typeof axios>;

function makeAxiosInstance(): jest.Mocked<AxiosInstance> {
  const fn = jest.fn() as unknown as jest.Mocked<AxiosInstance>;
  // Métodos que o service usa.
  fn.get = jest.fn() as unknown as jest.Mocked<AxiosInstance>['get'];
  fn.post = jest.fn() as unknown as jest.Mocked<AxiosInstance>['post'];
  fn.patch = jest.fn() as unknown as jest.Mocked<AxiosInstance>['patch'];
  fn.delete = jest.fn() as unknown as jest.Mocked<AxiosInstance>['delete'];
  fn.request = jest.fn() as unknown as jest.Mocked<AxiosInstance>['request'];
  return fn;
}

function makeModelMock(
  initial: TwitchConduitStatePersistence | null = null,
): jest.Mocked<Model<TwitchConduitStatePersistence>> {
  let state: TwitchConduitStatePersistence | null = initial;

  const findById = jest.fn().mockImplementation(() => ({
    lean: () => Promise.resolve(state),
  }));
  const updateOne = jest.fn().mockImplementation(async (_filter, update) => {
    const set = update?.$set ?? update;
    state = { ...(state ?? ({} as TwitchConduitStatePersistence)), ...set };
    return { acknowledged: true };
  });
  const deleteOne = jest.fn().mockImplementation(async () => {
    state = null;
    return { acknowledged: true };
  });

  return { findById, updateOne, deleteOne } as unknown as jest.Mocked<
    Model<TwitchConduitStatePersistence>
  >;
}

function asAxiosError(status: number): AxiosError {
  return Object.assign(new Error('axios error'), {
    isAxiosError: true,
    response: { status, data: {}, headers: {}, statusText: '', config: {} },
  }) as unknown as AxiosError;
}

describe('TwitchConduitService', () => {
  let http: jest.Mocked<AxiosInstance>;
  let helix: jest.Mocked<TwitchHelixService>;
  let model: jest.Mocked<Model<TwitchConduitStatePersistence>>;
  let service: TwitchConduitService;

  beforeEach(() => {
    http = makeAxiosInstance();
    axiosMock.create.mockReturnValue(http);

    helix = {
      getAppAccessToken: jest.fn().mockResolvedValue('app-token-123'),
    } as unknown as jest.Mocked<TwitchHelixService>;

    model = makeModelMock();
    service = new TwitchConduitService(helix, 'client-abc', model, 1);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureConduit', () => {
    it('cria um conduit novo quando nada existe local nem remoto', async () => {
      http.get.mockResolvedValueOnce({ data: { data: [] } } as unknown as ReturnType<
        typeof http.get
      >);
      http.post.mockResolvedValueOnce({
        data: { data: [{ id: 'cond-1', shard_count: 1 }] },
      } as unknown as ReturnType<typeof http.post>);

      const state = await service.ensureConduit();

      expect(state).toEqual({ conduitId: 'cond-1', shardCount: 1 });
      expect(http.post).toHaveBeenCalledWith(
        '/eventsub/conduits',
        { shard_count: 1 },
        expect.objectContaining({
          headers: expect.objectContaining({ 'Client-Id': 'client-abc' }),
        }),
      );
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: 'singleton' },
        expect.objectContaining({
          $set: expect.objectContaining({ conduitId: 'cond-1', shardCount: 1 }),
        }),
        { upsert: true },
      );
    });

    it('reutiliza o conduit local quando a Helix confirma que ainda existe', async () => {
      model = makeModelMock({
        _id: 'singleton',
        conduitId: 'cond-existing',
        shardCount: 2,
      } as TwitchConduitStatePersistence);
      service = new TwitchConduitService(helix, 'client-abc', model, 1);

      http.get.mockResolvedValueOnce({
        data: { data: [{ id: 'cond-existing', shard_count: 2 }] },
      } as unknown as ReturnType<typeof http.get>);

      const state = await service.ensureConduit();

      expect(state).toEqual({ conduitId: 'cond-existing', shardCount: 2 });
      expect(http.post).not.toHaveBeenCalled();
    });

    it('recria quando local existe mas Helix devolveu vazio', async () => {
      model = makeModelMock({
        _id: 'singleton',
        conduitId: 'cond-old',
        shardCount: 1,
      } as TwitchConduitStatePersistence);
      service = new TwitchConduitService(helix, 'client-abc', model, 1);

      // Primeira chamada GET (_findRemoteConduit) e segunda (_listRemoteConduits para criar) — vazios.
      http.get.mockResolvedValue({ data: { data: [] } } as unknown as ReturnType<typeof http.get>);
      http.post.mockResolvedValueOnce({
        data: { data: [{ id: 'cond-new', shard_count: 1 }] },
      } as unknown as ReturnType<typeof http.post>);

      const state = await service.ensureConduit();
      expect(state.conduitId).toBe('cond-new');
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('adota conduit existente quando o POST falha com 409', async () => {
      http.get
        .mockResolvedValueOnce({ data: { data: [] } } as unknown as ReturnType<typeof http.get>) // lista inicial vazia
        .mockResolvedValueOnce({
          data: { data: [{ id: 'cond-other', shard_count: 1 }] },
        } as unknown as ReturnType<typeof http.get>); // re-lista após 409
      http.post.mockRejectedValueOnce(asAxiosError(409));

      const state = await service.ensureConduit();
      expect(state.conduitId).toBe('cond-other');
    });
  });

  describe('assignShards', () => {
    it('envia PATCH com conduit_id e shards no body', async () => {
      http.patch.mockResolvedValueOnce({ data: {} } as unknown as ReturnType<typeof http.patch>);

      const shards: ConduitShardAssignment[] = [
        { id: '0', transport: { method: 'websocket', session_id: 'sess-1' } },
      ];
      await service.assignShards('cond-1', shards);

      expect(http.patch).toHaveBeenCalledWith(
        '/eventsub/conduits/shards',
        { conduit_id: 'cond-1', shards },
        expect.objectContaining({
          headers: expect.objectContaining({ 'Client-Id': 'client-abc' }),
        }),
      );
    });

    it('rejeita assignShards com lista vazia', async () => {
      await expect(service.assignShards('cond-1', [])).rejects.toThrow();
    });
  });

  describe('deleteConduit', () => {
    it('chama DELETE no Helix e limpa o estado local', async () => {
      http.delete.mockResolvedValueOnce({ data: {} } as unknown as ReturnType<typeof http.delete>);

      await service.deleteConduit('cond-1');

      expect(http.delete).toHaveBeenCalledWith(
        '/eventsub/conduits',
        expect.objectContaining({ params: { id: 'cond-1' } }),
      );
      expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'singleton' });
    });

    it('absorve 404 do Helix mas ainda limpa estado local', async () => {
      http.delete.mockRejectedValueOnce(asAxiosError(404));

      await service.deleteConduit('cond-1');

      expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'singleton' });
    });

    it('propaga outros erros de Helix sem mexer no estado local', async () => {
      http.delete.mockRejectedValueOnce(asAxiosError(500));

      await expect(service.deleteConduit('cond-1')).rejects.toBeDefined();
      expect(model.deleteOne).not.toHaveBeenCalled();
    });
  });
});
