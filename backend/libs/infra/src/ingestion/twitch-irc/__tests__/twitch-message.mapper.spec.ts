import { TwitchEmoteDictionary, slangNormalize } from '@sehloro/domain';
import { TwitchMessageMapper } from '../twitch-message.mapper';

const dictionary = new TwitchEmoteDictionary();

function makeUserstate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-abc',
    'user-id': 'u123',
    username: 'testuser',
    'display-name': 'TestUser',
    subscriber: false,
    mod: false,
    badges: {},
    emotes: undefined,
    ...overrides,
  };
}

describe('TwitchMessageMapper.toRaw', () => {
  it('normaliza campos básicos corretamente', () => {
    const msg = TwitchMessageMapper.toRaw(makeUserstate(), '#valorant_br', 'hello world');
    expect(msg.platform).toBe('twitch');
    expect(msg.channelName).toBe('valorant_br');
    expect(msg.channelExternalId).toBe('valorant_br');
    expect(msg.user.username).toBe('testuser');
    expect(msg.text).toBe('hello world');
    expect(msg.emotes).toEqual([]);
    expect(msg.mentions).toEqual([]);
  });

  it('remove # do channelName', () => {
    const msg = TwitchMessageMapper.toRaw(makeUserstate(), '#cblol', 'gg');
    expect(msg.channelName).toBe('cblol');
  });

  it('detecta subscriber via campo subscriber', () => {
    const msg = TwitchMessageMapper.toRaw(makeUserstate({ subscriber: true }), '#ch', 'hi');
    expect(msg.user.isSubscriber).toBe(true);
  });

  it('detecta subscriber via badge', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ badges: { subscriber: '6' } }),
      '#ch',
      'hi',
    );
    expect(msg.user.isSubscriber).toBe(true);
  });

  it('detecta broadcaster via badge', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ badges: { broadcaster: '1' } }),
      '#ch',
      'hi',
    );
    expect(msg.user.isBroadcaster).toBe(true);
  });

  it('converte badges para array "key/value"', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ badges: { subscriber: '6', moderator: '1' } }),
      '#ch',
      'hi',
    );
    expect(msg.user.badges).toContain('subscriber/6');
    expect(msg.user.badges).toContain('moderator/1');
  });

  it('parseia emotes do userstate e extrai código do texto', () => {
    // tmi.js formato: { '25': ['0-4'] } → Kappa no texto
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ emotes: { '25': ['0-4'] } }),
      '#ch',
      'Kappa bom jogo',
    );
    expect(msg.emotes).toHaveLength(1);
    expect(msg.emotes[0].code).toBe('Kappa');
    expect(msg.emotes[0].start).toBe(0);
    expect(msg.emotes[0].end).toBe(4);
    expect(msg.emotes[0].provider).toBe('twitch');
  });

  it('enriquece emote com semântica do dicionário', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ emotes: { '25': ['0-4'] } }),
      '#ch',
      'Kappa bom jogo',
      dictionary,
    );
    expect(msg.emotes[0].semantic).toBe('SARCASM');
    expect(msg.emotes[0].polarity).toBeCloseTo(-0.2);
    expect(msg.emotes[0].intensity).toBe('mid');
  });

  it('emote sem dicionário não tem campos semânticos', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ emotes: { '25': ['0-4'] } }),
      '#ch',
      'Kappa bom jogo',
    );
    expect(msg.emotes[0].semantic).toBeUndefined();
  });

  it('emote não encontrado no dicionário fica sem semântica', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ emotes: { '999': ['0-9'] } }),
      '#ch',
      'EmoteRaro bom',
      dictionary,
    );
    expect(msg.emotes[0].semantic).toBeUndefined();
  });

  it('parseia múltiplos emotes ordenados por posição', () => {
    const msg = TwitchMessageMapper.toRaw(
      makeUserstate({ emotes: { '25': ['6-10'], '1': ['0-4'] } }),
      '#ch',
      'PogCh Kappa',
    );
    expect(msg.emotes[0].start).toBeLessThan(msg.emotes[1].start);
  });

  it('extrai menções @username', () => {
    const msg = TwitchMessageMapper.toRaw(makeUserstate(), '#ch', '@rogerbatt boa jogada');
    expect(msg.mentions).toEqual([{ username: 'rogerbatt' }]);
  });

  it('mensagem sem emotes retorna emotes:[]', () => {
    const msg = TwitchMessageMapper.toRaw(makeUserstate(), '#ch', 'texto puro');
    expect(msg.emotes).toEqual([]);
  });

  it('usa fallback id quando userstate.id ausente', () => {
    const userstate = makeUserstate({ id: undefined });
    const msg = TwitchMessageMapper.toRaw(userstate, '#ch', 'hi');
    expect(msg.id).toMatch(/^tmi-\d+$/);
  });
});

describe('slangNormalize', () => {
  it('normaliza kkkkk para [LAUGH]', () => {
    expect(slangNormalize('kkkkk que jogada')).toContain('[LAUGH]');
  });

  it('normaliza rsrs para [LAUGH_MID]', () => {
    expect(slangNormalize('rsrs isso aí')).toContain('[LAUGH_MID]');
  });

  it('normaliza uepaaa para [HYPE_LOW]', () => {
    expect(slangNormalize('uepaaa que round')).toContain('[HYPE_LOW]');
  });

  it('normaliza pog para [HYPE]', () => {
    expect(slangNormalize('pog que clutch')).toContain('[HYPE]');
  });

  it('normaliza cheater para [CHEAT_SUSPECT]', () => {
    expect(slangNormalize('cheater detected')).toContain('[CHEAT_SUSPECT]');
  });

  it('preserva texto sem gírias', () => {
    expect(slangNormalize('bom jogo galera')).toBe('bom jogo galera');
  });

  it('case-insensitive', () => {
    expect(slangNormalize('KKKKK')).toContain('[LAUGH]');
  });
});

describe('TwitchEmoteDictionary', () => {
  it('tem entradas do seed', () => {
    expect(dictionary.has('Kappa')).toBe(true);
    expect(dictionary.has('PogChamp')).toBe(true);
    expect(dictionary.has('KEKW')).toBe(true);
  });

  it('get retorna entrada correta', () => {
    const entry = dictionary.get('PogChamp');
    expect(entry?.semantic).toBe('HYPE');
    expect(entry?.polarity).toBeGreaterThan(0);
    expect(entry?.intensity).toBe('high');
  });

  it('get retorna undefined para emote desconhecido', () => {
    expect(dictionary.get('EmoteInexistente')).toBeUndefined();
  });

  it('size é maior que 40', () => {
    expect(dictionary.size).toBeGreaterThan(40);
  });

  it('toCodeSet retorna Set de strings', () => {
    const set = dictionary.toCodeSet();
    expect(set.has('Kappa')).toBe(true);
    expect(set.has('LUL')).toBe(true);
  });

  it('aceita extraEntries no construtor', () => {
    const custom = new TwitchEmoteDictionary({
      CustomEmote: { semantic: 'HYPE', polarity: 0.5, intensity: 'mid' },
    });
    expect(custom.has('CustomEmote')).toBe(true);
    expect(custom.has('Kappa')).toBe(true); // seed preservado
  });
});
