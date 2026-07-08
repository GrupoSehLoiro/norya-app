/**
 * CHAT-02 · Tipo canônico RawMessage.
 *
 * Shape unificado que qualquer ChatProvider deve produzir, independente
 * da plataforma de origem (Twitch, Kick, etc.).
 *
 * Convenções de preenchimento:
 * - Twitch: `id` = tags['id'], `channelExternalId` = canal sem '#'
 * - Kick:   `id` = event.id do payload Pusher
 * - `emotes` sempre é array — vazio se a mensagem não tiver emotes.
 * - `rawPayload` preserva o payload original para debugging; nunca o inspecionar
 *   em lógica de negócio (usar os campos normalizados).
 * - `receivedAt` é o timestamp local de quando o provider recebeu a mensagem,
 *   não o timestamp do servidor da plataforma.
 */
import { createHash } from 'node:crypto';

export type RawMessageEmote = {
  /** Código do emote (ex: "Kappa", "PogChamp"). */
  code: string;
  /** Índice de início na string `text` (inclusivo). */
  start: number;
  /** Índice de fim na string `text` (inclusivo). */
  end: number;
  provider?: 'twitch' | 'bttv' | '7tv' | 'kick';
  /** Semântica afetiva — preenchida pelo TwitchMessageMapper via EmoteDictionary. */
  semantic?: import('./emote-dictionary').EmoteSemantic;
  /** Polaridade afetiva [-1, 1] — preenchida pelo mapper. */
  polarity?: number;
  /** Intensidade — preenchida pelo mapper. */
  intensity?: import('./emote-dictionary').EmoteIntensity;
};

export type RawMessageUser = {
  externalId: string;
  username: string;
  displayName: string;
  isSubscriber: boolean;
  isMod: boolean;
  isBroadcaster: boolean;
  /** Lista de badges no formato "badge/versão" (ex: "moderator/1"). */
  badges: string[];
};

export type RawMessageMention = {
  username: string;
};

export type RawMessage = {
  /** ID de idempotência gerado pelo provider (twitch: tags.id, kick: event.id). */
  id: string;
  platform: 'twitch' | 'kick';
  channelExternalId: string;
  channelName: string;
  user: RawMessageUser;
  text: string;
  emotes: RawMessageEmote[];
  mentions: RawMessageMention[];
  /** Payload original não-normalizado para debugging. Não usar em lógica de negócio. */
  rawPayload: unknown;
  /** Momento local em que o provider recebeu a mensagem. */
  receivedAt: Date;
};

/**
 * Namespace de helpers funcionais sobre RawMessage.
 * Não guardam estado; recebem um msg e devolvem resultado.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace RawMessage {
  /**
   * Porta a lógica de `isEmojiOnlyMessage` de Bot_SocialListening/index.js:
   * retorna true se o texto é coberto inteiramente por emotes conhecidos.
   *
   * Prioridade: (1) emotes do payload (ranges de índice); (2) dicionário
   * externo de códigos (BTTV, 7TV, emotes pt-BR de slang).
   */
  export function isEmoteOnly(msg: RawMessage, emoteDictionary?: ReadonlySet<string>): boolean {
    const stripped = msg.text.trim();
    if (!stripped) return false;

    if (msg.emotes.length > 0 && _isCoveredByRanges(stripped, msg.emotes)) {
      return true;
    }

    if (emoteDictionary && emoteDictionary.size > 0) {
      return stripped.split(/\s+/).every((token) => emoteDictionary.has(token));
    }

    return false;
  }

  /**
   * Extrai/normaliza o texto da mensagem com opções de filtragem.
   *
   * `stripEmotes`: remove os intervalos de emotes (útil para análise de sentimento).
   * `lowercase`: converte para minúsculas.
   * `stripAccents`: remove diacríticos (útil para stopwords pt-BR).
   */
  export function extractText(
    msg: RawMessage,
    opts: {
      stripEmotes?: boolean;
      lowercase?: boolean;
      stripAccents?: boolean;
    } = {},
  ): string {
    let text = msg.text;

    if (opts.stripEmotes && msg.emotes.length > 0) {
      // Remove intervalos de trás para frente para não deslocar índices
      const sorted = [...msg.emotes].sort((a, b) => b.start - a.start);
      for (const emote of sorted) {
        text = text.slice(0, emote.start) + text.slice(emote.end + 1);
      }
      text = text.replace(/\s+/g, ' ').trim();
    }

    if (opts.lowercase) {
      text = text.toLowerCase();
    }

    if (opts.stripAccents) {
      text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    return text;
  }

  /**
   * Hash SHA-256 curto (16 hex chars) de `channelExternalId|username|text`.
   * Usado para dedup de copypasta/mensagens repetidas no pipeline.
   */
  export function hash(msg: RawMessage): string {
    const input = `${msg.channelExternalId}|${msg.user.username}|${msg.text}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }

  /** @internal */
  export function _isCoveredByRanges(
    text: string,
    emotes: ReadonlyArray<Pick<RawMessageEmote, 'start' | 'end'>>,
  ): boolean {
    const covered = new Uint8Array(text.length);
    for (const emote of emotes) {
      const end = Math.min(emote.end, text.length - 1);
      for (let i = emote.start; i <= end; i++) {
        covered[i] = 1;
      }
    }
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ' ' && !covered[i]) return false;
    }
    return true;
  }
}
