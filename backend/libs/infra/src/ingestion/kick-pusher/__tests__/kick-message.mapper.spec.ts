/**
 * KCK-02/KCK-03 · KickMessageMapper — testes unitários.
 */
import { KickMessageMapper, KickChatMessageEvent } from '../kick-message.mapper';

function makeEvent(overrides: Partial<KickChatMessageEvent> = {}): KickChatMessageEvent {
  return {
    id: 'evt-1',
    chatroom_id: 999,
    content: 'hello world',
    type: 'message',
    created_at: '2026-05-04T12:00:00Z',
    sender: {
      id: 123,
      username: 'testuser',
      slug: 'testuser',
      identity: {
        color: '#FF6600',
        badges: [],
      },
    },
    ...overrides,
  };
}

describe('KickMessageMapper.toRaw', () => {
  it('normaliza campos básicos', () => {
    const msg = KickMessageMapper.toRaw(makeEvent(), 'xqc', 999);
    expect(msg.platform).toBe('kick');
    expect(msg.channelName).toBe('xqc');
    expect(msg.channelExternalId).toBe('999');
    expect(msg.user.username).toBe('testuser');
    expect(msg.text).toBe('hello world');
    expect(msg.emotes).toEqual([]);
    expect(msg.mentions).toEqual([]);
    expect(msg.receivedAt).toBeInstanceOf(Date);
  });

  it('extrai emotes no formato [emote:ID:NAME]', () => {
    const content = 'isso é [emote:12345:KEKW] demais [emote:99:PogChamp]';
    const msg = KickMessageMapper.toRaw(makeEvent({ content }), 'ch', 1);
    expect(msg.emotes).toHaveLength(2);
    expect(msg.emotes[0].code).toBe('KEKW');
    expect(msg.emotes[0].provider).toBe('kick');
    expect(msg.emotes[1].code).toBe('PogChamp');
    expect(msg.emotes[0].start).toBeLessThan(msg.emotes[1].start);
  });

  it('enriquece emote com semântica do dicionário', () => {
    const dict = {
      get: jest.fn((code: string) =>
        code === 'KEKW'
          ? { semantic: 'POSITIVE' as const, polarity: 0.7, intensity: 'high' as const }
          : undefined,
      ),
      has: jest.fn(),
      entries: jest.fn(),
      size: 1,
    };
    const content = '[emote:1:KEKW] que jogada';
    const msg = KickMessageMapper.toRaw(makeEvent({ content }), 'ch', 1, dict);
    expect(msg.emotes[0].semantic).toBe('POSITIVE');
    expect(msg.emotes[0].polarity).toBeCloseTo(0.7);
    expect(msg.emotes[0].intensity).toBe('high');
  });

  it('emote não encontrado no dicionário fica sem semântica', () => {
    const dict = {
      get: jest.fn(() => undefined),
      has: jest.fn(),
      entries: jest.fn(),
      size: 0,
    };
    const content = '[emote:1:UnknownEmote]';
    const msg = KickMessageMapper.toRaw(makeEvent({ content }), 'ch', 1, dict);
    expect(msg.emotes[0].semantic).toBeUndefined();
  });

  it('extrai menções @username', () => {
    const content = '@rogerbatt bom clutch';
    const msg = KickMessageMapper.toRaw(makeEvent({ content }), 'ch', 1);
    expect(msg.mentions).toEqual([{ username: 'rogerbatt' }]);
  });

  it('detecta subscriber via badge', () => {
    const event = makeEvent({
      sender: {
        id: 1,
        username: 'sub',
        slug: 'sub',
        identity: {
          badges: [{ type: 'subscriber', text: '3' }],
        },
      },
    });
    const msg = KickMessageMapper.toRaw(event, 'ch', 1);
    expect(msg.user.isSubscriber).toBe(true);
    expect(msg.user.badges).toContain('subscriber/3');
  });

  it('detecta broadcaster via badge', () => {
    const event = makeEvent({
      sender: {
        id: 1,
        username: 'streamer',
        slug: 'streamer',
        identity: {
          badges: [{ type: 'broadcaster' }],
        },
      },
    });
    const msg = KickMessageMapper.toRaw(event, 'ch', 1);
    expect(msg.user.isBroadcaster).toBe(true);
  });

  it('mensagem sem emotes retorna emotes:[]', () => {
    const msg = KickMessageMapper.toRaw(makeEvent(), 'ch', 1);
    expect(msg.emotes).toEqual([]);
  });

  it('externalId do sender é string do id numérico', () => {
    const msg = KickMessageMapper.toRaw(makeEvent(), 'ch', 1);
    expect(msg.user.externalId).toBe('123');
  });

  it('rawPayload preserva evento original', () => {
    const event = makeEvent();
    const msg = KickMessageMapper.toRaw(event, 'ch', 1);
    expect(msg.rawPayload).toBe(event);
  });
});
