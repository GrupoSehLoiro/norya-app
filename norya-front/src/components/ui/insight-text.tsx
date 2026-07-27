/**
 * Renderiza o texto vindo do LLM (resumos/insights) com formatação limpa.
 *
 * O modelo devolve markdown leve — `**negrito**`, `*itálico*`, `` `código` ``,
 * listas com `-`/`•` e um prefixo "**Insight:**" — que estava aparecendo cru
 * na UI. Aqui parseamos só esse subconjunto (sem dependência de lib) e
 * descartamos o rótulo "Insight:" inicial, redundante sob o título da seção.
 */

import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  // **negrito** | *itálico* | `código`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-ink-800">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-ink-800">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function InsightText({ text, className }: { text: string; className?: string }) {
  const clean = text
    .trim()
    // "**Insight:**", "Insight:", "**Resumo:**" etc. no começo — redundante.
    .replace(/^\*{0,2}(insight|resumo|análise)\s*:?\*{0,2}\s*:?\s*/i, '');

  // Blocos separados por linha em branco; linhas de lista viram <ul>.
  const blocks = clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return (
    <div className={className ?? 'space-y-2 text-sm leading-relaxed text-ink-700'}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((l) => /^[-•*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi} className="space-y-1 pl-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span aria-hidden className="mt-[0.55em] h-1 w-1 flex-shrink-0 rounded-full bg-accent-400/70" />
                  <span>{inline(l.replace(/^[-•*]\s+/, ''), `${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={bi}>{inline(lines.join(' '), `${bi}`)}</p>;
      })}
    </div>
  );
}
