'use client';

/**
 * Peças vivas da landing (seções aprovadas — manter):
 *  - ChatRail: rio de mensagens do chat rolando no hero (CSS marquee), com
 *    sentimento por mensagem e a anotação da Norya "pinada" por cima.
 *  - Ticker: fita horizontal que alterna o que o CHAT grita com o que a
 *    NORYA detecta — a história de uma live em uma linha.
 */

// ─── ChatRail (hero) ───────────────────────────────────────────────────────

const RAIL: Array<{ user: string; text: string; s: 'pos' | 'neu' | 'neg' }> = [
  { user: 'tvzin', text: 'QUE JOGADA INSANA', s: 'pos' },
  { user: 'maria99', text: 'clipa isso agora', s: 'pos' },
  { user: 'bimelol', text: 'kkkkkkkkkk', s: 'pos' },
  { user: 'zeh', text: 'não acredito no que eu vi', s: 'pos' },
  { user: 'pedrog', text: 'essa red bull gelada ia cair bem', s: 'neu' },
  { user: 'ana_flow', text: 'melhor live da semana, fácil', s: 'pos' },
  { user: 'notturno', text: 'vai ranqueada agora?', s: 'neu' },
  { user: 'fps_carol', text: 'caiu o ping de novo…', s: 'neg' },
  { user: 'keeb_dan', text: 'troca o servidor pfv', s: 'neg' },
  { user: 'gabizx', text: 'chegou meu sub de 3 meses!', s: 'pos' },
  { user: 'luquinhas', text: 'alguma marca patrocina esse homem', s: 'neu' },
  { user: 'rafa_tt', text: 'o aim tá absurdo hoje', s: 'pos' },
  { user: 'vevs', text: 'esse mapa novo é muito lindo', s: 'pos' },
  { user: 'grilo', text: 'gg, partidaça', s: 'pos' },
];

const DOT: Record<'pos' | 'neu' | 'neg', string> = {
  pos: 'bg-ok',
  neu: 'bg-white/30',
  neg: 'bg-err',
};

export function ChatRail() {
  const items = [...RAIL, ...RAIL]; // loop contínuo
  return (
    <div aria-hidden className="relative hidden h-[520px] select-none md:block">
      {/* máscara de fade em cima/embaixo */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
        }}
      >
        <ul className="animate-rail flex flex-col gap-2.5 pr-2">
          {items.map((m, i) => (
            <li
              key={i}
              className="flex w-fit max-w-full items-center gap-2.5 rounded-2xl rounded-bl-sm border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13.5px]"
            >
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[m.s]}`} />
              <span className="font-medium text-ink-700">{m.user}</span>
              <span className="truncate text-ink-400">{m.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* anotação da Norya, pinada sobre o rio — "chega" ~1s depois do load,
          como uma detecção acontecendo em cima do chat que já corria */}
      <div
        className="pin-in absolute -left-6 top-1/2 w-[280px] -translate-y-1/2 rounded-2xl border border-accent-400/25 bg-bg-1/95 p-4 shadow-elevated"
        style={{ backdropFilter: 'blur(16px)' }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-300">
          norya · 21:12:44
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-800">
          Pico detectado: 3× o volume normal. Jogada decisiva, pedidos de clipe
          em massa — vale cortar.
        </p>
        <p className="mt-2 font-mono text-[10px] text-ink-400">+212% msgs · 91% positivo</p>
      </div>

      <style jsx>{`
        @keyframes rail {
          from { transform: translateY(0); }
          to { transform: translateY(-50%); }
        }
        .animate-rail {
          animation: rail 26s linear infinite;
        }
        @keyframes pin-in {
          from {
            opacity: 0;
            transform: translateY(calc(-50% + 12px)) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(-50%) scale(1);
          }
        }
        .pin-in {
          opacity: 0;
          animation: pin-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.9s forwards;
        }
      `}</style>
    </div>
  );
}

// ─── Ticker ────────────────────────────────────────────────────────────────

// O ticker alterna o que o CHAT grita com o que a NORYA detecta — a fita é a
// história de uma live: hype → pico → menção de marca → queda → relatório.
const TERMS = [
  'que jogada insana',
  'pico às 21:12',
  'clipa isso',
  '+212% de mensagens',
  'clutch',
  'corte sugerido',
  'red bull citada 35×',
  'clima 74% positivo',
  'kkkkkkkk',
  'momento viral',
  'pedido de patrocínio',
  'assunto: ranqueada',
  'caiu o ping',
  'queda de clima às 22:03',
  'gg partidaça',
  'relatório pronto',
];

export function Ticker() {
  const row = [...TERMS, ...TERMS];
  return (
    <div aria-hidden className="select-none overflow-hidden border-y border-white/[0.06] py-4">
      <div className="animate-ticker flex w-max items-center gap-8 font-mono text-[12px] uppercase tracking-[0.2em] text-ink-400/50">
        {row.map((t, i) => (
          <span key={i} className="flex items-center gap-8">
            {t} <span className="text-accent-400/40">·</span>
          </span>
        ))}
      </div>
      <style jsx>{`
        @keyframes ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker 32s linear infinite;
        }
      `}</style>
    </div>
  );
}
