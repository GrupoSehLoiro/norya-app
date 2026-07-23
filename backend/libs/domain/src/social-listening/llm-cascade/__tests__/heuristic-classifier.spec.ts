import type { RawMessage } from '../../../ingestion/raw-message';
import { TwitchEmoteDictionary } from '../../../ingestion/emote-dictionary';
import { classifyHeuristic } from '../heuristic-classifier';
import type { ClassifierConfigs } from '../types';
import { emptyConfigs } from '../types';

function mkMsg(text: string, username = 'alice', opts?: { isMod?: boolean }): RawMessage {
  return {
    id: 'm_' + Math.random(),
    platform: 'twitch',
    channelExternalId: 'c',
    channelName: 'c',
    user: {
      externalId: 'u_' + username,
      username,
      displayName: username,
      isSubscriber: false,
      isMod: opts?.isMod ?? false,
      isBroadcaster: false,
      badges: [],
    },
    text,
    emotes: [],
    mentions: [],
    rawPayload: {},
    receivedAt: new Date(),
  };
}

function withConfigs(
  over: Partial<{
    positive: string[];
    negative: string[];
    neutral: string[];
    categories: Record<string, string[]>;
    blockedWords: string[];
    blockedUsers: string[];
    botUsers: string[];
  }>,
): ClassifierConfigs {
  return {
    sentiment: {
      positive: new Set(over.positive ?? []),
      negative: new Set(over.negative ?? []),
      neutral: new Set(over.neutral ?? []),
    },
    categories: new Map(Object.entries(over.categories ?? {}).map(([k, v]) => [k, new Set(v)])),
    blockedWords: new Set(over.blockedWords ?? []),
    blockedUsers: new Set((over.blockedUsers ?? []).map((u) => u.toLowerCase())),
    botUsers: new Set((over.botUsers ?? []).map((u) => u.toLowerCase())),
  };
}

describe('classifyHeuristic — drops', () => {
  it('drop_bot quando username em botUsers', () => {
    const cfg = withConfigs({ botUsers: ['streamelements'] });
    const r = classifyHeuristic({ msg: mkMsg('oi', 'streamelements'), configs: cfg });
    expect(r.kind).toBe('drop_bot');
  });

  it('drop_command para texto começando com !', () => {
    const r = classifyHeuristic({ msg: mkMsg('!seguidores'), configs: emptyConfigs() });
    expect(r.kind).toBe('drop_command');
  });

  it('drop_command para /', () => {
    const r = classifyHeuristic({ msg: mkMsg('/ban xyz'), configs: emptyConfigs() });
    expect(r.kind).toBe('drop_command');
  });

  it('drop_short para texto < 3 chars', () => {
    expect(classifyHeuristic({ msg: mkMsg('oi'), configs: emptyConfigs() }).kind).toBe(
      'drop_short',
    );
    expect(classifyHeuristic({ msg: mkMsg('  a '), configs: emptyConfigs() }).kind).toBe(
      'drop_short',
    );
  });

  it('drop_mention_only', () => {
    expect(classifyHeuristic({ msg: mkMsg('@bob'), configs: emptyConfigs() }).kind).toBe(
      'drop_mention_only',
    );
    expect(classifyHeuristic({ msg: mkMsg('@bob @alice  '), configs: emptyConfigs() }).kind).toBe(
      'drop_mention_only',
    );
  });

  it('drop_moderation por blockedWords (case-insensitive)', () => {
    const cfg = withConfigs({ blockedWords: ['xyz'] });
    expect(classifyHeuristic({ msg: mkMsg('isso é XYZ aqui'), configs: cfg }).kind).toBe(
      'drop_moderation',
    );
  });

  it('drop_moderation por blockedUsers', () => {
    const cfg = withConfigs({ blockedUsers: ['troll1'] });
    expect(classifyHeuristic({ msg: mkMsg('texto comum', 'troll1'), configs: cfg }).kind).toBe(
      'drop_moderation',
    );
  });
});

describe('classifyHeuristic — keep + hints', () => {
  it('sentimentHint via keyword positiva', () => {
    const cfg = withConfigs({ positive: ['top'] });
    const r = classifyHeuristic({ msg: mkMsg('isso é top demais'), configs: cfg });
    expect(r.kind).toBe('keep');
    expect(r.sentimentHint).toBe('positive');
  });

  it('majoritário entre pos/neg ganha', () => {
    const cfg = withConfigs({ positive: ['bom', 'top'], negative: ['rage'] });
    const r = classifyHeuristic({ msg: mkMsg('bom mas rage no chefe'), configs: cfg });
    expect(r.sentimentHint).toBeDefined();
    // 1 pos vs 1 neg → empate, retorna 'positive' por desempate da função
    expect(['positive', 'negative']).toContain(r.sentimentHint);
  });

  it('sem match → sentimentHint undefined', () => {
    const r = classifyHeuristic({ msg: mkMsg('frase neutra qualquer'), configs: emptyConfigs() });
    expect(r.kind).toBe('keep');
    expect(r.sentimentHint).toBeUndefined();
  });

  it('categoryHint = categoria com mais matches', () => {
    const cfg = withConfigs({
      categories: { game: ['valorant', 'rank'], meta: ['stream'] },
    });
    const r = classifyHeuristic({ msg: mkMsg('jogou valorant subiu rank'), configs: cfg });
    expect(r.categoryHint).toBe('game');
  });
});

describe('classifyHeuristic — emojis Unicode', () => {
  const dict = new TwitchEmoteDictionary();

  it('mensagem só de emojis (run colado) → keep com hint positivo', () => {
    const r = classifyHeuristic({
      msg: mkMsg('😂😂😂'),
      configs: emptyConfigs(),
      emoteDictionary: dict,
    });
    expect(r.kind).toBe('keep');
    expect(r.categoryHint).toBe('emote_only');
    expect(r.sentimentHint).toBe('positive');
  });

  it('emoji único curto NÃO cai em drop_short', () => {
    const r = classifyHeuristic({
      msg: mkMsg('🔥'),
      configs: emptyConfigs(),
      emoteDictionary: dict,
    });
    expect(r.kind).toBe('keep');
    expect(r.sentimentHint).toBe('positive');
  });

  it('emoji negativo → hint negativo', () => {
    const r = classifyHeuristic({
      msg: mkMsg('🤡🤡'),
      configs: emptyConfigs(),
      emoteDictionary: dict,
    });
    expect(r.kind).toBe('keep');
    expect(r.sentimentHint).toBe('negative');
  });

  it('sem dicionário, emoji único continua caindo em drop_short (comportamento antigo)', () => {
    const r = classifyHeuristic({ msg: mkMsg('🔥'), configs: emptyConfigs() });
    expect(r.kind).toBe('drop_short');
  });
});
