/**
 * Integração do módulo `legacy` (Fase 4 do plano de "menu Legado no console").
 *
 * Não exerce HTTP — boots `PersistenceModule + LegacyModule` contra
 * `mongodb-memory-server`, semeia documentos diretamente nas collections
 * legadas (`bans`, `timeouts`, `messagedeleteds`, `predictions`, `polls`,
 * `emojis`) usando os modelos Mongoose registrados, e valida cada service:
 *
 *   - paginação respeitando `page` / `pageSize`
 *   - filtro por `channel`
 *   - filtro por intervalo de datas (`startDate` / `endDate`)
 *   - `count()` total
 *   - `countByChannel()` agrupando corretamente
 *   - `exportRows()` devolvendo a coleção completa filtrada
 *
 * Cobre também o `toCsv` (utilitário inline) com casos de escaping.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  PersistenceModule,
  BanPersistence,
  BanSchemaName,
  TimeoutPersistence,
  TimeoutSchemaName,
  MessageDeletedPersistence,
  MessageDeletedSchemaName,
  PredictionPersistence,
  PredictionSchemaName,
  PollPersistence,
  PollSchemaName,
  ChatEmojiPersistence,
  ChatEmojiSchemaName,
} from '@sehloro/infra';
import { LegacyModule } from '../src/legacy/legacy.module';
import { BansService } from '../src/legacy/bans/bans.service';
import { TimeoutsService } from '../src/legacy/timeouts/timeouts.service';
import { RemovedMessagesService } from '../src/legacy/removed/removed.service';
import { PredictionsService } from '../src/legacy/predictions/predictions.service';
import { PollsService } from '../src/legacy/polls/polls.service';
import { EmojisService } from '../src/legacy/emojis/emojis.service';
import { toCsv, formatBrasilia } from '../src/legacy/csv.util';
import type { ListQuery, ExportQuery } from '../src/legacy/dto/list-query.dto';

const D = (iso: string) => new Date(iso);

function buildQuery(partial: Partial<ListQuery> = {}): ListQuery {
  return { page: 1, pageSize: 20, ...partial };
}
function buildExportQuery(partial: Partial<ExportQuery> = {}): ExportQuery {
  return { ...partial };
}

describe('Legacy module integration', () => {
  let mongo: MongoMemoryServer;
  let app: TestingModule;

  let banModel: Model<BanPersistence>;
  let timeoutModel: Model<TimeoutPersistence>;
  let removedModel: Model<MessageDeletedPersistence>;
  let predictionModel: Model<PredictionPersistence>;
  let pollModel: Model<PollPersistence>;
  let emojiModel: Model<ChatEmojiPersistence>;

  let bans: BansService;
  let timeouts: TimeoutsService;
  let removed: RemovedMessagesService;
  let predictions: PredictionsService;
  let polls: PollsService;
  let emojis: EmojisService;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'a'.repeat(40);
    process.env.CRYPTO_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.LOG_LEVEL = 'fatal';

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true }),
        MongooseModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>('MONGODB_URI'),
            serverSelectionTimeoutMS: 5000,
          }),
        }),
        PersistenceModule,
        LegacyModule,
      ],
    }).compile();
    await app.init();

    banModel = app.get(getModelToken(BanSchemaName));
    timeoutModel = app.get(getModelToken(TimeoutSchemaName));
    removedModel = app.get(getModelToken(MessageDeletedSchemaName));
    predictionModel = app.get(getModelToken(PredictionSchemaName));
    pollModel = app.get(getModelToken(PollSchemaName));
    emojiModel = app.get(getModelToken(ChatEmojiSchemaName));

    bans = app.get(BansService);
    timeouts = app.get(TimeoutsService);
    removed = app.get(RemovedMessagesService);
    predictions = app.get(PredictionsService);
    polls = app.get(PollsService);
    emojis = app.get(EmojisService);
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      banModel.deleteMany({}),
      timeoutModel.deleteMany({}),
      removedModel.deleteMany({}),
      predictionModel.deleteMany({}),
      pollModel.deleteMany({}),
      emojiModel.deleteMany({}),
    ]);
  });

  // ── BANS ───────────────────────────────────────────────────────────────
  describe('BansService', () => {
    beforeEach(async () => {
      await banModel.insertMany([
        {
          channel: 'leozeraplay',
          userName: 'troll1',
          reason: 'spam',
          modName: 'mod_a',
          timestamp: D('2026-05-20T10:00:00Z'),
        },
        {
          channel: 'leozeraplay',
          userName: 'troll2',
          reason: 'flood',
          modName: 'mod_a',
          timestamp: D('2026-05-21T10:00:00Z'),
        },
        {
          channel: 'rogerbatt',
          userName: 'troll3',
          reason: 'hate',
          modName: 'mod_b',
          timestamp: D('2026-05-22T10:00:00Z'),
        },
        {
          channel: 'gauleslays',
          userName: 'troll4',
          reason: 'spoiler',
          modName: 'mod_c',
          timestamp: D('2026-05-23T10:00:00Z'),
        },
      ]);
    });

    it('lista paginada ordenada por timestamp DESC', async () => {
      const result = await bans.list(buildQuery({ pageSize: 2 }));
      expect(result.total).toBe(4);
      expect(result.totalPages).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.userName).toBe('troll4');
      expect(result.items[1]!.userName).toBe('troll3');
    });

    it('filtra por canal', async () => {
      const result = await bans.list(buildQuery({ channel: 'leozeraplay' }));
      expect(result.total).toBe(2);
      expect(result.items.every((i) => i.channel === 'leozeraplay')).toBe(true);
    });

    it('filtra por intervalo de datas', async () => {
      const result = await bans.list(
        buildQuery({
          startDate: D('2026-05-21T00:00:00Z'),
          endDate: D('2026-05-22T23:59:59Z'),
        }),
      );
      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.userName).sort()).toEqual(['troll2', 'troll3']);
    });

    it('count total', async () => {
      expect(await bans.count()).toBe(4);
    });

    it('countByChannel agrupa corretamente', async () => {
      const rows = await bans.countByChannel();
      const map = Object.fromEntries(rows.map((r) => [r.channel, r.count]));
      expect(map['leozeraplay']).toBe(2);
      expect(map['rogerbatt']).toBe(1);
      expect(map['gauleslays']).toBe(1);
    });

    it('exportRows respeita filtros', async () => {
      const rows = await bans.exportRows(buildExportQuery({ channel: 'leozeraplay' }));
      expect(rows).toHaveLength(2);
      expect(rows[0]!.userName).toBe('troll1'); // sort ASC no export
      expect(rows[1]!.userName).toBe('troll2');
    });
  });

  // ── TIMEOUTS ───────────────────────────────────────────────────────────
  describe('TimeoutsService', () => {
    beforeEach(async () => {
      await timeoutModel.insertMany([
        {
          channel: 'leozeraplay',
          userName: 'u1',
          reason: 'caps',
          tempoDeTO: 60,
          modName: 'mod_a',
          timestamp: D('2026-05-20T10:00:00Z'),
        },
        {
          channel: 'leozeraplay',
          userName: 'u2',
          reason: 'spam',
          tempoDeTO: 600,
          modName: 'mod_a',
          timestamp: D('2026-05-21T10:00:00Z'),
        },
        {
          channel: 'rogerbatt',
          userName: 'u3',
          reason: 'flood',
          tempoDeTO: 1800,
          modName: 'mod_b',
          timestamp: D('2026-05-22T10:00:00Z'),
        },
      ]);
    });

    it('lista paginada com `tempoDeTO` preservado', async () => {
      const result = await timeouts.list(buildQuery());
      expect(result.total).toBe(3);
      expect(result.items[0]!.tempoDeTO).toBe(1800);
    });

    it('count + countByChannel', async () => {
      expect(await timeouts.count()).toBe(3);
      const rows = await timeouts.countByChannel();
      expect(rows.find((r) => r.channel === 'leozeraplay')?.count).toBe(2);
    });
  });

  // ── REMOVED MESSAGES ───────────────────────────────────────────────────
  describe('RemovedMessagesService', () => {
    beforeEach(async () => {
      await removedModel.insertMany([
        {
          channel: 'leozeraplay',
          username: 'spammer1',
          deletedMessage: 'link.bait',
          timestamp: D('2026-05-20T10:00:00Z'),
        },
        {
          channel: 'leozeraplay',
          username: 'spammer2',
          deletedMessage: 'AAA AAA',
          timestamp: D('2026-05-21T10:00:00Z'),
        },
        {
          channel: 'rogerbatt',
          username: 'spammer3',
          deletedMessage: 'spoiler',
          timestamp: D('2026-05-22T10:00:00Z'),
        },
      ]);
    });

    it('lista e expõe `deletedMessage` preservado', async () => {
      const result = await removed.list(buildQuery());
      expect(result.total).toBe(3);
      expect(result.items[0]!.deletedMessage).toBe('spoiler');
    });

    it('count + countByChannel', async () => {
      expect(await removed.count()).toBe(3);
      const rows = await removed.countByChannel();
      expect(rows.find((r) => r.channel === 'leozeraplay')?.count).toBe(2);
    });
  });

  // ── PREDICTIONS ────────────────────────────────────────────────────────
  describe('PredictionsService', () => {
    beforeEach(async () => {
      await predictionModel.insertMany([
        {
          predictionId: 'p1',
          channel: 'leozeraplay',
          title: 'Lula vai vencer?',
          winningOutcome: 'opt-yes',
          created_at: D('2026-05-20T10:00:00Z'),
          ended_at: D('2026-05-20T10:10:00Z'),
          locked_at: D('2026-05-20T10:05:00Z'),
          options: [
            { id: 'opt-yes', title: 'Sim', totalBetAmount: 5000, users: 42, topBetters: [] },
            { id: 'opt-no', title: 'Não', totalBetAmount: 3000, users: 28, topBetters: [] },
          ],
        },
        {
          predictionId: 'p2',
          channel: 'rogerbatt',
          title: 'Time A vence?',
          winningOutcome: 'opt-b',
          created_at: D('2026-05-21T10:00:00Z'),
          ended_at: D('2026-05-21T10:10:00Z'),
          locked_at: D('2026-05-21T10:05:00Z'),
          options: [
            { id: 'opt-a', title: 'A', totalBetAmount: 1000, users: 10, topBetters: [] },
            { id: 'opt-b', title: 'B', totalBetAmount: 2000, users: 20, topBetters: [] },
          ],
        },
      ]);
    });

    it('lista calcula totais agregados e vencedora', async () => {
      const result = await predictions.list(buildQuery());
      expect(result.total).toBe(2);
      const lula = result.items.find((p) => p.predictionId === 'p1');
      expect(lula!.totalPoints).toBe(8000);
      expect(lula!.totalUsers).toBe(70);
      expect(lula!.winningTitle).toBe('Sim');
    });

    it('listChannels devolve canais únicos', async () => {
      const chans = await predictions.listChannels();
      expect(chans.sort()).toEqual(['leozeraplay', 'rogerbatt']);
    });

    it('filtra por canal e por intervalo de `created_at`', async () => {
      const result = await predictions.list(
        buildQuery({
          channel: 'rogerbatt',
          startDate: D('2026-05-21T00:00:00Z'),
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items[0]!.predictionId).toBe('p2');
    });
  });

  // ── POLLS ──────────────────────────────────────────────────────────────
  describe('PollsService', () => {
    beforeEach(async () => {
      await pollModel.insertMany([
        {
          pollId: 'po1',
          channel: 'leozeraplay',
          title: 'Próximo jogo?',
          created_at: D('2026-05-20T10:00:00Z'),
          ended_at: D('2026-05-20T10:05:00Z'),
          duration: 300,
          choices: [
            { id: 'c1', title: 'CS', votes: 100, channel_points_votes: 20, bits_votes: 5 },
            { id: 'c2', title: 'Valorant', votes: 80, channel_points_votes: 50, bits_votes: 0 },
          ],
          bits_voting_enabled: true,
          bits_per_vote: 100,
          channel_points_voting_enabled: true,
          channel_points_per_vote: 500,
        },
      ]);
    });

    it('lista agrega votos e identifica a vencedora pelo total', async () => {
      const result = await polls.list(buildQuery());
      expect(result.total).toBe(1);
      const poll = result.items[0]!;
      expect(poll.totalVotes).toBe(180);
      expect(poll.totalChannelPointsVotes).toBe(70);
      expect(poll.totalBitsVotes).toBe(5);
      expect(poll.totalAllVotes).toBe(255);
      // CS = 100+20+5 = 125; Valorant = 80+50+0 = 130 → Valorant vence
      expect(poll.winningTitle).toBe('Valorant');
    });

    it('listChannels devolve canais únicos', async () => {
      const chans = await polls.listChannels();
      expect(chans).toEqual(['leozeraplay']);
    });
  });

  // ── EMOJIS ─────────────────────────────────────────────────────────────
  describe('EmojisService', () => {
    beforeEach(async () => {
      await emojiModel.insertMany([
        {
          channel: 'leozeraplay',
          username: 'u1',
          message: 'KEKW lol',
          emoji: 'KEKW',
          timestamp: D('2026-05-20T10:00:00Z'),
        },
        {
          channel: 'leozeraplay',
          username: 'u2',
          message: 'Pog!',
          emoji: 'PogChamp',
          timestamp: D('2026-05-21T10:00:00Z'),
        },
        {
          channel: 'rogerbatt',
          username: 'u3',
          message: 'kkkk',
          emoji: 'KEKW',
          timestamp: D('2026-05-22T10:00:00Z'),
        },
      ]);
    });

    it('lista paginada + count + countByChannel', async () => {
      expect((await emojis.list(buildQuery())).total).toBe(3);
      expect(await emojis.count()).toBe(3);
      const rows = await emojis.countByChannel();
      expect(rows.find((r) => r.channel === 'leozeraplay')?.count).toBe(2);
    });
  });

  // ── CSV util ───────────────────────────────────────────────────────────
  describe('toCsv util', () => {
    it('serializa headers + rows básicos', () => {
      const csv = toCsv(
        [{ a: 1, b: 'foo' }],
        [
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B' },
        ],
      );
      expect(csv).toBe('A,B\r\n1,foo');
    });

    it('escapa vírgula, aspas e newline', () => {
      const csv = toCsv([{ msg: 'hello, "world"\r\nnext' }], [{ key: 'msg', header: 'msg' }]);
      expect(csv).toBe('msg\r\n"hello, ""world""\r\nnext"');
    });

    it('formata Date em fuso de Brasília', () => {
      // 2026-05-20T13:00:00Z → 10:00 BRT
      const csv = toCsv([{ t: new Date('2026-05-20T13:00:00Z') }], [{ key: 't', header: 't' }]);
      expect(csv).toContain('20/05/2026 10:00:00');
    });

    it('null/undefined viram célula vazia', () => {
      const csv = toCsv(
        [{ a: null, b: undefined, c: 'x' }],
        [
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B' },
          { key: 'c', header: 'C' },
        ],
      );
      expect(csv).toBe('A,B,C\r\n,,x');
    });

    it('formatBrasilia padroniza dd/MM/yyyy HH:mm:ss', () => {
      expect(formatBrasilia(new Date('2026-01-15T13:30:45Z'))).toBe('15/01/2026 10:30:45');
    });
  });
});
