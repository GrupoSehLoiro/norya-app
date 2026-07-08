jest.mock('axios');

import axios from 'axios';
import type { AxiosError, AxiosInstance } from 'axios';
import { Types, type Model } from 'mongoose';
import { TwitchHelixService } from '../../twitch-irc/twitch-helix.service';
import { TwitchConduitSubscriptionsService } from '../twitch-conduit-subscriptions.service';
import type { TwitchEventSubSubscriptionPersistence } from '../../../persistence/mongoose/schemas/twitch-eventsub-subscription.schema';

const axiosMock = axios as jest.Mocked<typeof axios>;

function makeAxiosInstance(): jest.Mocked<AxiosInstance> {
  const fn = jest.fn() as unknown as jest.Mocked<AxiosInstance>;
  fn.get = jest.fn() as unknown as jest.Mocked<AxiosInstance>['get'];
  fn.post = jest.fn() as unknown as jest.Mocked<AxiosInstance>['post'];
  fn.delete = jest.fn() as unknown as jest.Mocked<AxiosInstance>['delete'];
  return fn;
}

function makeModelMock(
  seed: Array<Partial<TwitchEventSubSubscriptionPersistence>> = [],
): jest.Mocked<Model<TwitchEventSubSubscriptionPersistence>> {
  const docs: Array<Partial<TwitchEventSubSubscriptionPersistence>> = [...seed];

  function matches(
    doc: Partial<TwitchEventSubSubscriptionPersistence>,
    filter: Record<string, unknown>,
  ): boolean {
    for (const [k, v] of Object.entries(filter)) {
      const docVal = (doc as Record<string, unknown>)[k];
      if (v instanceof Types.ObjectId && docVal instanceof Types.ObjectId) {
        if (!docVal.equals(v)) return false;
      } else if (docVal !== v) {
        return false;
      }
    }
    return true;
  }

  const find = jest.fn().mockImplementation((filter: Record<string, unknown>) => ({
    lean: async () => docs.filter((d) => matches(d, filter)),
  }));

  const findOneAndUpdate = jest
    .fn()
    .mockImplementation(
      async (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options: { upsert?: boolean } = {},
      ) => {
        const idx = docs.findIndex((d) => matches(d, filter));
        const set = ((update.$set as Record<string, unknown>) ??
          update) as Partial<TwitchEventSubSubscriptionPersistence>;
        if (idx >= 0) {
          docs[idx] = { ...docs[idx], ...set };
          return docs[idx];
        }
        if (options.upsert) {
          const created = { ...filter, ...set } as Partial<TwitchEventSubSubscriptionPersistence>;
          docs.push(created);
          return created;
        }
        return null;
      },
    );

  const deleteMany = jest.fn().mockImplementation(async (filter: Record<string, unknown>) => {
    for (let i = docs.length - 1; i >= 0; i--) {
      if (matches(docs[i]!, filter)) docs.splice(i, 1);
    }
    return { acknowledged: true };
  });

  const updateOne = jest
    .fn()
    .mockImplementation(
      async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const idx = docs.findIndex((d) => matches(d, filter));
        if (idx >= 0) {
          const set = (update.$set as Record<string, unknown>) ?? update;
          docs[idx] = { ...docs[idx], ...set };
        }
        return { acknowledged: true };
      },
    );

  return { find, findOneAndUpdate, deleteMany, updateOne } as unknown as jest.Mocked<
    Model<TwitchEventSubSubscriptionPersistence>
  >;
}

function asAxiosError(status: number): AxiosError {
  return Object.assign(new Error('axios error'), {
    isAxiosError: true,
    response: { status, data: {}, headers: {}, statusText: '', config: {} },
  }) as unknown as AxiosError;
}

describe('TwitchConduitSubscriptionsService', () => {
  let http: jest.Mocked<AxiosInstance>;
  let helix: jest.Mocked<TwitchHelixService>;
  let model: jest.Mocked<Model<TwitchEventSubSubscriptionPersistence>>;
  let service: TwitchConduitSubscriptionsService;
  const channelObjectId = new Types.ObjectId();

  beforeEach(() => {
    http = makeAxiosInstance();
    axiosMock.create.mockReturnValue(http);

    helix = {
      getAppAccessToken: jest.fn().mockResolvedValue('app-token-xyz'),
    } as unknown as jest.Mocked<TwitchHelixService>;

    model = makeModelMock();
    service = new TwitchConduitSubscriptionsService(helix, 'client-abc', model);
  });

  afterEach(() => jest.clearAllMocks());

  describe('subscribeChannel', () => {
    it('cria as 7 subscriptions com transports e conditions corretos', async () => {
      // Cada POST devolve um id em ordem — types na ordem do service:
      // chat + message_delete (unshift, exigem botUserId), depois lifecycle
      // + legacy feed (online, offline, ban, poll, prediction).
      const ids = [
        'sub-chat',
        'sub-msg-delete',
        'sub-online',
        'sub-offline',
        'sub-ban',
        'sub-poll',
        'sub-prediction',
      ];
      http.post.mockImplementation(
        async () =>
          ({
            data: { data: [{ id: ids.shift()!, status: 'enabled', type: 'x', version: '1' }] },
          }) as unknown as ReturnType<typeof http.post>,
      );

      const result = await service.subscribeChannel({
        channelId: channelObjectId,
        channelExternalId: '999',
        conduitId: 'cond-1',
        botUserId: 'bot-77',
      });

      expect(result).toHaveLength(7);
      expect(http.post).toHaveBeenCalledTimes(7);

      // condition de channel.chat.message inclui broadcaster_user_id + user_id (bot).
      const chatCall = http.post.mock.calls.find(
        ([, body]) => (body as { type?: string }).type === 'channel.chat.message',
      )!;
      const chatBody = chatCall[1] as {
        condition: Record<string, string>;
        transport: Record<string, string>;
      };
      expect(chatBody.condition).toEqual({ broadcaster_user_id: '999', user_id: 'bot-77' });
      expect(chatBody.transport).toEqual({ method: 'conduit', conduit_id: 'cond-1' });

      // condition de stream.online/offline inclui apenas broadcaster_user_id.
      const onlineCall = http.post.mock.calls.find(
        ([, body]) => (body as { type?: string }).type === 'stream.online',
      )!;
      const onlineBody = onlineCall[1] as { condition: Record<string, string> };
      expect(onlineBody.condition).toEqual({ broadcaster_user_id: '999' });
    });

    it('é idempotente: 2x não duplica POST nem registro local', async () => {
      const ids = [
        'sub-chat',
        'sub-msg-delete',
        'sub-online',
        'sub-offline',
        'sub-ban',
        'sub-poll',
        'sub-prediction',
      ];
      http.post.mockImplementation(
        async () =>
          ({
            data: { data: [{ id: ids.shift()!, status: 'enabled', type: 'x', version: '1' }] },
          }) as unknown as ReturnType<typeof http.post>,
      );

      await service.subscribeChannel({
        channelId: channelObjectId,
        channelExternalId: '999',
        conduitId: 'cond-1',
        botUserId: 'bot-77',
      });
      expect(http.post).toHaveBeenCalledTimes(7);

      await service.subscribeChannel({
        channelId: channelObjectId,
        channelExternalId: '999',
        conduitId: 'cond-1',
        botUserId: 'bot-77',
      });
      // Segunda chamada não dispara novos POSTs porque tudo está `enabled`.
      expect(http.post).toHaveBeenCalledTimes(7);
    });

    it('em 409 tenta descobrir o subscriptionId via list e persiste mesmo assim', async () => {
      http.post.mockRejectedValue(asAxiosError(409));
      http.get.mockResolvedValue({
        data: {
          data: [
            { id: 'remote-chat', type: 'channel.chat.message', status: 'enabled', version: '1' },
            { id: 'remote-online', type: 'stream.online', status: 'enabled', version: '1' },
            { id: 'remote-offline', type: 'stream.offline', status: 'enabled', version: '1' },
          ],
        },
      } as unknown as ReturnType<typeof http.get>);

      const result = await service.subscribeChannel({
        channelId: channelObjectId,
        channelExternalId: '999',
        conduitId: 'cond-1',
        botUserId: 'bot-77',
      });

      expect(result.map((r) => r.subscriptionId)).toEqual([
        'remote-chat',
        'remote-online',
        'remote-offline',
      ]);
    });
  });

  describe('unsubscribeChannel', () => {
    it('deleta cada subscriptionId no Helix e limpa os docs locais', async () => {
      model = makeModelMock([
        {
          channelId: channelObjectId,
          channelExternalId: '999',
          type: 'channel.chat.message',
          subscriptionId: 'sub-a',
          conduitId: 'cond-1',
          status: 'enabled',
        },
        {
          channelId: channelObjectId,
          channelExternalId: '999',
          type: 'stream.online',
          subscriptionId: 'sub-b',
          conduitId: 'cond-1',
          status: 'enabled',
        },
      ]);
      service = new TwitchConduitSubscriptionsService(helix, 'client-abc', model);
      http.delete.mockResolvedValue({ data: {} } as unknown as ReturnType<typeof http.delete>);

      await service.unsubscribeChannel(channelObjectId);

      expect(http.delete).toHaveBeenCalledTimes(2);
      expect(http.delete).toHaveBeenCalledWith(
        '/eventsub/subscriptions',
        expect.objectContaining({ params: { id: 'sub-a' } }),
      );
      expect(model.deleteMany).toHaveBeenCalled();
    });

    it('absorve 404 do DELETE remoto', async () => {
      model = makeModelMock([
        {
          channelId: channelObjectId,
          channelExternalId: '999',
          type: 'stream.online',
          subscriptionId: 'sub-x',
          conduitId: 'cond-1',
          status: 'enabled',
        },
      ]);
      service = new TwitchConduitSubscriptionsService(helix, 'client-abc', model);
      http.delete.mockRejectedValueOnce(asAxiosError(404));

      await expect(service.unsubscribeChannel(channelObjectId)).resolves.not.toThrow();
      expect(model.deleteMany).toHaveBeenCalled();
    });

    it('no-op quando o canal não tem nenhuma subscription local', async () => {
      await service.unsubscribeChannel(channelObjectId);
      expect(http.delete).not.toHaveBeenCalled();
      expect(model.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('markRevoked', () => {
    it('atualiza status e revokedAt', async () => {
      model = makeModelMock([
        {
          subscriptionId: 'sub-1',
          channelId: channelObjectId,
          channelExternalId: '1',
          type: 'channel.chat.message',
          conduitId: 'c',
          status: 'enabled',
        },
      ]);
      service = new TwitchConduitSubscriptionsService(helix, 'client-abc', model);

      await service.markRevoked('sub-1', 'authorization_revoked');

      expect(model.updateOne).toHaveBeenCalledWith(
        { subscriptionId: 'sub-1' },
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'revoked' }),
        }),
      );
    });
  });
});
