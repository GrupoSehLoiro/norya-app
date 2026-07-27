'use client';

/**
 * Skin de chat por plataforma — a estética fiel do chat da Twitch e da Kick,
 * compartilhada entre o Feed ao vivo e qualquer lista de mensagens do console
 * (ex.: drill-down do gráfico de atividade).
 *
 * Uso:
 *   <ul className={`chat-skin skin-${platform} ...`}>
 *     {msgs.map((m) => <ChatLine key={m.messageId} m={m} platform={platform} emotes={emotes} />)}
 *   </ul>
 *   <ChatSkinStyles />   // uma vez por página que renderiza chat
 */
import { EmoteText } from '@/components/ui/emote-text';
import type { ChannelEmote } from '@/hooks/use-channel-emotes';

export type ChatPlatform = 'twitch' | 'kick';

/** Paleta default OFICIAL da Twitch (as 15 cores do seletor do chat). */
const TWITCH_COLORS = [
  '#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50',
  '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E',
  '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F',
];

/** Paleta de usernames da Kick (seletor do chat — tons neon). */
const KICK_COLORS = [
  '#10D5C2', '#3DE81E', '#54F58F', '#7B7BF0', '#A18CF5',
  '#C2F04C', '#EFA3DD', '#8FA3AD', '#EFF5A9', '#AFF5C6',
  '#F53C55', '#F55C28', '#F546BE', '#F5A03C', '#F5D5A4',
];

function hashName(username: string): number {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = Math.imul(h, 31) + username.charCodeAt(i);
  // finalizer estilo murmur — sem isso o módulo enviesa (tudo caía no roxo)
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return Math.abs(h);
}

/**
 * Clareia cores escuras demais pro fundo escuro — mesmo truque da Twitch
 * (o azul #0000FF puro é ilegível no dark; a Twitch "levanta" a luminância).
 */
function readableOnDark(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0..255
  if (lum >= 110) return hex;
  const lift = (110 - lum) / 255;
  const up = (c: number) => Math.min(255, Math.round(c + (255 - c) * lift * 1.6));
  return `#${[up(r), up(g), up(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function nameColor(username: string, platform: ChatPlatform): string {
  const palette = platform === 'kick' ? KICK_COLORS : TWITCH_COLORS;
  const raw = palette[hashName(username) % palette.length] ?? palette[0]!;
  return readableOnDark(raw);
}

/** Badges no desenho de cada plataforma (mod = espada, sub = estrela/gema). */
export function ChatBadge({ kind, platform }: { kind: 'mod' | 'sub'; platform: ChatPlatform }) {
  const sword = 'M12.6 2.2 7.4 7.4 6.2 6.2 4.8 7.6l1.3 1.3-2.9 2.9v1.7h1.7l2.9-2.9 1.3 1.3 1.4-1.4-1.2-1.2 5.2-5.2V2.2z';
  const star = 'M8 1.8l1.9 3.8 4.2.6-3 3 .7 4.2L8 11.4l-3.8 2 .7-4.2-3-3 4.2-.6z';
  if (platform === 'twitch') {
    return (
      <svg className="chat-badge" viewBox="0 0 16 16" aria-hidden>
        <rect width="16" height="16" rx="2.5" fill={kind === 'mod' ? '#00ad03' : '#9147ff'} />
        <path d={kind === 'mod' ? sword : star} fill="#fff" transform="scale(0.94) translate(0.5 0.5)" />
      </svg>
    );
  }
  // Kick: ícones sem caixa — espada verde da marca / gema de assinante
  return kind === 'mod' ? (
    <svg className="chat-badge" viewBox="0 0 16 16" aria-hidden>
      <path d={sword} fill="#53fc18" />
    </svg>
  ) : (
    <svg className="chat-badge" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 1.2 14 8l-6 6.8L2 8z" fill="#00fff2" />
      <path d="M8 3.6 11.9 8 8 12.4 4.1 8z" fill="#0e5f5a" opacity="0.55" />
    </svg>
  );
}

export interface ChatLineMessage {
  messageId: string;
  username: string;
  text: string;
  isMod: boolean;
  isSubscriber: boolean;
}

/** Uma linha de chat no estilo da plataforma: [badges] nome: mensagem. */
export function ChatLine({
  m,
  platform,
  emotes,
  className,
}: {
  m: ChatLineMessage;
  platform: ChatPlatform;
  emotes: Map<string, ChannelEmote>;
  className?: string;
}) {
  return (
    <li className={`chat-row ${className ?? ''}`}>
      {m.isMod && <ChatBadge kind="mod" platform={platform} />}
      {m.isSubscriber && <ChatBadge kind="sub" platform={platform} />}
      <span className="chat-name" style={{ color: nameColor(m.username, platform) }}>
        {m.username}
        {/* na Kick o ":" herda a cor do nome; na Twitch é branco (override CSS) */}
        <span className="chat-colon">: </span>
      </span>
      <EmoteText text={m.text} emotes={emotes} className="chat-text" />
    </li>
  );
}

/** CSS das skins — global (dedupe pelo styled-jsx), incluir 1x por página. */
export function ChatSkinStyles() {
  return (
    <style jsx global>{`
      /* ── base compartilhada: linhas flat de chat, texto corrido ─────── */
      .chat-skin {
        background: var(--chat-bg);
        font-family: Inter, Roobert, 'Helvetica Neue', Helvetica, Arial, sans-serif;
      }
      .chat-skin .chat-row {
        padding: var(--row-pad) 8px;
        border-radius: 4px;
        font-size: 13px;
        line-height: 20px;
        overflow-wrap: anywhere;
        list-style: none;
      }
      .chat-skin .chat-row:hover {
        background: var(--row-hover);
      }
      .chat-skin .chat-badge {
        display: inline-block;
        width: var(--badge-size);
        height: var(--badge-size);
        margin-right: 4px;
        vertical-align: -3px;
      }
      .chat-skin .chat-name {
        font-weight: var(--name-weight);
      }
      .chat-skin .chat-text {
        color: var(--chat-text);
        font-weight: var(--msg-weight);
      }
      .chat-skin .chat-text img {
        vertical-align: middle;
        height: var(--emote-size) !important;
      }

      /* ── Twitch: #18181b, nome semibold, texto #efeff1, ":" branco ──── */
      .skin-twitch {
        --chat-bg: #18181b;
        --chat-text: #efeff1;
        --row-hover: rgba(255, 255, 255, 0.06);
        --row-pad: 2.5px;
        --name-weight: 600;
        --msg-weight: 400;
        --badge-size: 18px;
        --emote-size: 1.75em;
      }
      .skin-twitch .chat-colon {
        color: var(--chat-text);
        font-weight: 400;
      }

      /* ── Kick: quase-preto, nome bold com ":" na MESMA cor (herda),
            mensagem semibold, linhas mais respiradas ───────────────────── */
      .skin-kick {
        --chat-bg: #0b0b0b;
        --chat-text: #f7f8f8;
        --row-hover: rgba(255, 255, 255, 0.05);
        --row-pad: 5px;
        --name-weight: 700;
        --msg-weight: 600;
        --badge-size: 15px;
        --emote-size: 1.9em;
      }
      .skin-kick .chat-colon {
        color: inherit;
      }

      /* ── tema claro do console: Twitch tem chat claro; Kick é sempre dark ── */
      html.light .skin-twitch {
        --chat-bg: #f7f7f8;
        --chat-text: #0e0e10;
        --row-hover: rgba(0, 0, 0, 0.05);
      }
      html.light .skin-twitch .chat-name {
        filter: brightness(0.8) saturate(1.2);
      }

      /* chegada suave de mensagem nova (mesmo easing do pin-in do /landing) */
      .chat-skin .msg-in {
        animation: chat-msg-in 480ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      @keyframes chat-msg-in {
        from {
          opacity: 0;
          transform: translateY(14px) scale(0.97);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `}</style>
  );
}
