'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';

/**
 * Motion com propósito (não decoração):
 *
 *  - `Reveal`: o conteúdo entra quando o leitor chega nele — como um dado que
 *    acabou de ser detectado. Variantes `left/right` fazem os callouts
 *    "apontarem" para o painel; `delay` cria a chegada em sequência.
 *  - `ProductFrame`: a linha do gráfico SE DESENHA quando visível — o chat
 *    streamando em tempo real, contado em 1.4s.
 *  - Marca-texto do manifesto risca a palavra quando a frase aparece
 *    (via CSS `.marker-sweep` + estado `.in` do Reveal pai).
 *
 * Uma vez só (sem re-trigger a cada scroll) e desligado por completo sob
 * `prefers-reduced-motion`.
 */

function useInView<T extends Element>(threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

/**
 * Entrada do hero (framer): o bloco de texto chega uma vez, suave — a única
 * animação de load da página.
 */
export function HeroIntro({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Parallax de camada (framer, scroll-linked): deslocamento vertical sutil
 * proporcional ao scroll — dá profundidade entre texto e produto sem roubar
 * atenção. `speed` positivo = camada "mais perto" (anda contra o scroll).
 * Desligado sob prefers-reduced-motion.
 */
export function Parallax({
  children,
  speed = 0.3,
  className,
}: {
  children: ReactNode;
  speed?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [speed * 70, speed * -70]);
  return (
    <motion.div ref={ref} style={reduced ? undefined : { y }} className={className}>
      {children}
    </motion.div>
  );
}

export function Reveal({
  children,
  variant = 'up',
  delay = 0,
  className,
}: {
  children: ReactNode;
  variant?: 'up' | 'left' | 'right';
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-reveal={variant}
      className={`${inView ? 'in' : ''} ${className ?? ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Estilos globais do motion — renderizar UMA vez na página. */
export function MotionStyles() {
  return (
    <style jsx global>{`
      [data-reveal] {
        opacity: 0;
        transition:
          opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1),
          transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: opacity, transform;
      }
      [data-reveal='up'] { transform: translateY(22px); }
      [data-reveal='left'] { transform: translateX(-26px); }
      [data-reveal='right'] { transform: translateX(26px); }
      [data-reveal].in {
        opacity: 1;
        transform: none;
      }

      /* marca-texto do manifesto: risca a palavra quando a frase aparece */
      .marker-sweep {
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.35s;
      }
      [data-reveal].in .marker-sweep {
        transform: scaleX(1) rotate(-1deg);
      }

      @media (prefers-reduced-motion: reduce) {
        [data-reveal],
        [data-reveal='up'],
        [data-reveal='left'],
        [data-reveal='right'] {
          opacity: 1 !important;
          transform: none !important;
          transition: none !important;
        }
        .marker-sweep {
          transform: scaleX(1) rotate(-1deg) !important;
          transition: none !important;
        }
        .animate-rail,
        .animate-ticker,
        .pf-line,
        .pf-area {
          animation: none !important;
          transition: none !important;
          stroke-dashoffset: 0 !important;
          opacity: 1 !important;
          transform: none !important;
        }
      }
    `}</style>
  );
}

/**
 * Painel central de "Recursos": quando entra na tela, a linha do gráfico se
 * desenha (o chat chegando em tempo real) e o recorte/agulhas acendem depois
 * — a ordem da animação é a ordem do produto: dado → análise → recorte.
 */
export function ProductFrame() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  return (
    <div
      ref={ref}
      aria-hidden
      className={`glass-card order-1 p-5 shadow-elevated lg:order-2 ${inView ? 'pf-in' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-ink-800">Atividade do chat</p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-400/25 bg-accent-400/[0.07] px-2.5 py-0.5 text-[10px] font-medium text-accent-300">
          <span className="inline-block h-1 w-1 rounded-full bg-accent-400" /> ao vivo
        </span>
      </div>
      <svg viewBox="0 0 400 120" className="w-full">
        <defs>
          <linearGradient id="pf-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d7fe01" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#d7fe01" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path
          className="pf-area"
          d="M0 95 C30 80 50 40 80 48 C110 56 125 88 155 90 C185 92 205 35 235 30 C265 26 285 62 315 68 C345 74 375 55 400 48 L400 120 L0 120 Z"
          fill="url(#pf-g)"
        />
        <path
          className="pf-line"
          d="M0 95 C30 80 50 40 80 48 C110 56 125 88 155 90 C185 92 205 35 235 30 C265 26 285 62 315 68 C345 74 375 55 400 48"
          fill="none"
          stroke="#d7fe01"
          strokeWidth="1.8"
        />
        <g className="pf-sel" stroke="#d7fe01" strokeWidth="1">
          <line x1="215" y1="6" x2="215" y2="114" />
          <line x1="262" y1="6" x2="262" y2="114" />
        </g>
        <rect className="pf-sel" x="215" y="6" width="47" height="108" fill="#d7fe01" opacity="0.05" />
        <circle className="pf-sel" cx="235" cy="30" r="3.5" fill="#d7fe01" stroke="rgba(0,0,0,0.55)" strokeWidth="1.5" />
      </svg>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-400">clima</p>
          <p className="mt-0.5 text-sm font-bold text-ok">74% positivo</p>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-400">marcas</p>
          <p className="mt-0.5 text-sm font-bold text-ink-800">red bull <span className="text-accent-300">35</span></p>
        </div>
      </div>

      <style jsx>{`
        .pf-line {
          stroke-dasharray: 620;
          stroke-dashoffset: 620;
        }
        .pf-area,
        .pf-sel {
          opacity: 0;
        }
        .pf-in .pf-line {
          transition: stroke-dashoffset 1.4s ease-out;
          stroke-dashoffset: 0;
        }
        .pf-in .pf-area {
          transition: opacity 0.8s ease-out 0.9s;
          opacity: 1;
        }
        .pf-in .pf-sel {
          transition: opacity 0.5s ease-out 1.5s;
          opacity: 1;
        }
        .pf-in rect.pf-sel {
          opacity: 0.05;
        }
      `}</style>
    </div>
  );
}
