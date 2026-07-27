'use client';

import { memo, type ReactNode } from 'react';
import type { ChannelEmote } from '@/hooks/use-channel-emotes';

interface Props {
  text: string;
  emotes: Map<string, ChannelEmote>;
  className?: string;
}

/**
 * Marcador de emote nativo do Kick embutido no texto da mensagem:
 * `[emote:37226:KEKW]`. O ID basta pra derivar a URL da imagem no CDN —
 * não depende de dicionário nenhum.
 */
const KICK_EMOTE_RE = /\[emote:(\d+):([^\]]+)\]/g;

function emoteImg(key: string, src: string, srcSet: string | undefined, alt: string, title: string) {
  return (
    // Emotes vêm dos CDNs da Twitch/BTTV/FFZ/7TV/Kick já minúsculos —
    // next/image só adicionaria proxy e custo; img cru é o certo aqui.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={key}
      src={src}
      srcSet={srcSet}
      alt={alt}
      title={title}
      loading="lazy"
      className="inline-block h-[1.6em] w-auto align-middle"
    />
  );
}

/** Troca palavras que são emotes (dicionário do canal) por imagem. */
function renderWords(text: string, emotes: Map<string, ChannelEmote>, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\s+)/);
  return parts.map((part, i) => {
    const emote = emotes.get(part);
    if (!emote) return part;
    return emoteImg(
      `${keyPrefix}-${i}-${emote.code}`,
      emote.url,
      emote.url2x ? `${emote.url} 1x, ${emote.url2x} 2x` : undefined,
      emote.code,
      `${emote.code} · ${emote.provider}`,
    );
  });
}

/**
 * Texto de mensagem do chat com emotes renderizados como imagem.
 * Duas passadas, ambas O(n) e sem rede:
 *   1. marcadores nativos do Kick `[emote:ID:NOME]` → imagem direto pelo ID;
 *   2. palavras inteiras presentes no dicionário do canal (Twitch/BTTV/FFZ/7TV).
 */
export const EmoteText = memo(function EmoteText({ text, emotes, className }: Props) {
  const hasKickMarker = text.includes('[emote:');

  if (!hasKickMarker) {
    if (emotes.size === 0) return <span className={className}>{text}</span>;
    const parts = text.split(/(\s+)/);
    if (!parts.some((p) => emotes.has(p))) return <span className={className}>{text}</span>;
    return <span className={className}>{renderWords(text, emotes, 'w')}</span>;
  }

  // Kick: intercala segmentos de texto (que ainda passam pelo dicionário,
  // p/ 7TV em canal Kick) com as imagens derivadas dos marcadores.
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(KICK_EMOTE_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(...renderWords(text.slice(last, m.index), emotes, `s${last}`));
    const [, id, name] = m;
    nodes.push(
      emoteImg(`k-${m.index}`, `https://files.kick.com/emotes/${id}/fullsize`, undefined, name!, `${name} · kick`),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...renderWords(text.slice(last), emotes, `s${last}`));

  return <span className={className}>{nodes}</span>;
});
