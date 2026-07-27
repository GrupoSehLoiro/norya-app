import Link from 'next/link';
import type { Metadata } from 'next';
import { ChatRail, Ticker } from './landing-demo';
import { HeroIntro, MotionStyles, Parallax, ProductFrame, Reveal } from './motion';

export const metadata: Metadata = {
  title: 'Norya: o chat não para. Você não precisa ler.',
  description:
    'Social listening em tempo real para lives na Twitch e na Kick. O chat inteiro, lido e traduzido enquanto a live acontece.',
};

/**
 * Landing page pública (/landing).
 *
 * Conceito: "a live, anotada" — layout editorial assimétrico com estética de
 * transmissão. As seções aprovadas (hero com rio de chat, ticker, "feita para
 * quem vive de live") usam o mono como assinatura; as
 * demais seguem a mesma linguagem: manifesto com marca-texto, produto anotado
 * com callouts, FAQ editorial e CTA como anotação da Norya.
 */
export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden text-ink-800">
      <MotionStyles />
      <Header />
      <main>
        <Hero />
        <Manifesto />
        <AnnotatedProduct />
        <Ticker />
        <ForWho />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-bg-0/70" style={{ backdropFilter: 'blur(14px)' }}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5">
        <Link href="/landing" className="text-lg font-bold tracking-tight text-ink-800">
          Norya<span className="text-accent-400">.</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex" aria-label="Navegação">
          <a href="#recursos" className="text-[13.5px] text-ink-400 transition-colors hover:text-ink-800">Recursos</a>
          <a href="#casos-de-uso" className="text-[13.5px] text-ink-400 transition-colors hover:text-ink-800">Casos de uso</a>
          <a href="#faq" className="text-[13.5px] text-ink-400 transition-colors hover:text-ink-800">Perguntas</a>
        </nav>
        <div className="flex items-center gap-5">
          <Link href="/login" className="text-[13.5px] text-ink-400 transition-colors hover:text-ink-800">
            Entrar
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-accent-400 px-5 py-2 text-[13.5px] font-semibold text-bg-0 transition-opacity hover:opacity-90"
          >
            Criar conta
          </Link>
        </div>
      </div>
    </header>
  );
}

// ─── Hero (aprovado — não mexer) ───────────────────────────────────────────

function Hero() {
  return (
    <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-36 md:grid-cols-[1.15fr_0.85fr] md:pt-44">
      <HeroIntro>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-400">
          Social listening · Twitch + Kick
        </p>
        <h1 className="mt-5 text-[13vw] font-bold leading-[0.98] tracking-[-0.035em] text-ink-800 md:text-[76px]">
          O chat
          <br />
          não para.
          <br />
          <span className="text-accent-400">Você não</span>
          <br />
          <span className="text-accent-400">precisa ler.</span>
        </h1>
        <p className="mt-7 max-w-md text-[15px] leading-relaxed text-ink-400">
          A Norya lê o chat da sua live inteiro e
          te devolve o que importa: o clima, os picos e o que fazer com eles.
          Em português, enquanto a live acontece.
        </p>
        <div className="mt-9 flex items-center gap-6">
          <Link
            href="/signup"
            className="rounded-full bg-accent-400 px-7 py-3.5 text-[15px] font-semibold text-bg-0 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(215,254,1,0.22)]"
          >
            Começar agora
          </Link>
          <a href="#recursos" className="text-sm text-ink-400 underline-offset-4 transition-colors hover:text-ink-700 hover:underline">
            Ver recursos
          </a>
        </div>
      </HeroIntro>

      {/* camada "mais perto": o rio anda levemente contra o scroll */}
      <Parallax speed={0.35}>
        <ChatRail />
      </Parallax>
    </section>
  );
}

// ─── Manifesto (frase com marca-texto) ─────────────────────────────────────

function Manifesto() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 py-32 text-center">
      <Parallax speed={-0.18}>
      <Reveal>
        <p className="mx-auto max-w-4xl text-4xl font-bold leading-[1.08] tracking-[-0.03em] text-ink-800 md:text-6xl">
          <mark className="relative bg-transparent text-ink-800">
            {/* o marca-texto risca a palavra quando a frase entra na tela */}
            <span aria-hidden className="marker-sweep absolute inset-x-[-2px] bottom-[0.06em] h-[0.42em] bg-accent-400/25" />
            <span className="relative">Achismo</span>
          </mark>{' '}
          não fecha patrocínio.
        </p>
        <p className="mx-auto mt-8 max-w-xl font-mono text-[11px] uppercase leading-relaxed tracking-[0.22em] text-ink-400">
          a sua live gera milhares de sinais por hora
          <br className="hidden md:block" />
          a norya transforma sinal em prova
        </p>
      </Reveal>
      </Parallax>
    </section>
  );
}

// ─── Recursos (produto em destaque + bento de features) ────────────────────

const FEATURES = [
  {
    span: 'lg:col-span-2',
    tag: 'Clima ao vivo',
    title: 'O sentimento do chat, a cada 15 segundos',
    desc: 'A Norya lê cada mensagem e te devolve o clima em tempo real: positivo, neutro ou negativo. Você sente a virada antes que ela vire problema.',
    visual: 'clima',
  },
  {
    span: 'lg:col-span-2',
    tag: 'Picos explicados',
    title: 'Todo pico do gráfico, explicado',
    desc: 'Recorte um momento da live e a IA resume o que fez a galera reagir: a jogada, o corte, o anúncio.',
    visual: 'pico',
  },
  {
    span: 'lg:col-span-1',
    tag: 'Marcas',
    title: 'Menções que viram prova',
    desc: 'Cada citação de marca contada e contextualizada. O número que o patrocinador quer ver.',
    visual: null,
  },
  {
    span: 'lg:col-span-1',
    tag: 'Nicho',
    title: 'Fluente no seu nicho',
    desc: '“Ace”, “clutch”, emote e meme entram como hype, não como ruído.',
    visual: 'nicho',
  },
  {
    span: 'lg:col-span-1',
    tag: 'Relatório',
    title: 'O pós-live em PDF',
    desc: 'Clima, picos e marcas do dia num relatório pronto pra mandar pra marca.',
    visual: null,
  },
  {
    span: 'lg:col-span-1',
    tag: 'Histórico',
    title: 'Memória pesquisável',
    desc: 'Toda live passada fica buscável, com resumo de qualquer trecho.',
    visual: null,
  },
] as const;

function AnnotatedProduct() {
  return (
    <section id="recursos" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 pb-32">
      <Reveal>
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.25em] text-ink-400">
          Recursos
        </p>
        <h2 className="mx-auto mt-4 max-w-2xl text-center text-3xl font-bold leading-tight tracking-[-0.02em] text-ink-800 md:text-5xl">
          Tudo que a Norya lê na sua live<span className="text-accent-400">.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-center text-[15px] leading-relaxed text-ink-400">
          Uma tela só pra tudo que acontece no chat enquanto você joga: o clima, os
          picos, as marcas e o que fazer com cada um.
        </p>
      </Reveal>

      {/* Produto em destaque */}
      <Parallax speed={0.16} className="mt-14">
        <div className="mx-auto max-w-[460px]">
          <ProductFrame />
        </div>
      </Parallax>

      {/* Bento de features */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 2) * 90} className={f.span}>
            <FeatureCard tag={f.tag} title={f.title} desc={f.desc} visual={f.visual} />
          </Reveal>
        ))}

        {/* Banner "sem bot" — largura total, com CTA */}
        <Reveal delay={90} className="lg:col-span-4">
          <div className="flex flex-col items-start justify-between gap-5 rounded-2xl border border-accent-400/25 bg-accent-400/[0.05] p-7 sm:flex-row sm:items-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-300">Twitch + Kick</p>
              <p className="mt-2 text-xl font-semibold tracking-tight text-ink-800">
                Sem bot no canal, sem overlay, sem instalação.
              </p>
              <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-400">
                Você conecta pela conta oficial da plataforma. Na sua próxima live, o
                painel já está acompanhando o chat.
              </p>
            </div>
            <Link
              href="/signup"
              className="shrink-0 rounded-full bg-accent-400 px-6 py-3 text-sm font-semibold text-bg-0 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(215,254,1,0.22)]"
            >
              Conectar meu canal
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FeatureCard({
  tag, title, desc, visual,
}: {
  tag: string;
  title: string;
  desc: string;
  visual: string | null;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 transition-colors hover:border-white/[0.14]">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-300">{tag}</p>
      <p className="mt-2.5 text-lg font-semibold leading-snug tracking-[-0.01em] text-ink-800">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">{desc}</p>
      {visual === 'clima' && <ClimaBar />}
      {visual === 'pico' && <PicoSpark />}
      {visual === 'nicho' && <NichoChips />}
    </div>
  );
}

function ClimaBar() {
  return (
    <div className="mt-auto pt-6">
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <span className="bg-ok" style={{ width: '74%' }} />
        <span className="bg-white/25" style={{ width: '18%' }} />
        <span className="bg-err" style={{ width: '8%' }} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-ink-400">
        <span className="text-ok">74% positivo</span>
        <span>8% negativo</span>
      </div>
    </div>
  );
}

function PicoSpark() {
  return (
    <div className="mt-auto pt-6">
      <svg viewBox="0 0 220 44" className="w-full" aria-hidden>
        <polyline
          points="0,36 26,30 48,33 72,15 96,22 116,6 140,24 168,19 220,26"
          fill="none"
          stroke="#d7fe01"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="116" cy="6" r="3.5" fill="#d7fe01" />
      </svg>
    </div>
  );
}

function NichoChips() {
  return (
    <div className="mt-auto flex flex-wrap gap-1.5 pt-6">
      {['ace', 'clutch', 'GG', 'Pog', 'clipa'].map((t) => (
        <span
          key={t}
          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-ink-600"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

// ─── Para quem (aprovado — não mexer) ──────────────────────────────────────

const AUDIENCES = [
  {
    label: 'streamers',
    text: 'Os momentos que merecem clipe, a reação a cada quadro, e números profissionais para quem patrocina.',
  },
  {
    label: 'marcas & agências',
    text: 'O retorno real de uma ação em live: menções, tom e comparação entre canais. Dado, não achismo.',
  },
  {
    label: 'esports',
    text: 'Vários canais ao mesmo tempo, crises detectadas cedo, histórico completo pesquisável.',
  },
] as const;

function ForWho() {
  return (
    <section id="casos-de-uso" className="mx-auto max-w-[1200px] scroll-mt-24 px-5 py-32">
      <div className="grid gap-12 md:grid-cols-[0.8fr_1.2fr]">
        <h2 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-ink-800 md:sticky md:top-28 md:self-start md:text-5xl">
          Feita para
          <br />
          quem vive
          <br />
          de live<span className="text-accent-400">.</span>
        </h2>
        <div className="flex flex-col">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.label} delay={i * 120}>
              <div className="border-t border-white/[0.07] py-8 first:border-t-0 first:pt-0">
                <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent-300">
                  para {a.label}
                </p>
                <p className="mt-3 max-w-lg text-lg leading-relaxed text-ink-700 md:text-xl">
                  {a.text}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ (editorial, sem accordion) ────────────────────────────────────────

const FAQS = [
  {
    q: 'Preciso instalar algo ou dar mod para um bot?',
    a: 'Não. Você conecta sua conta Twitch ou Kick pelo login oficial e pronto. Sem bot no canal, sem overlay, sem instalação.',
  },
  {
    q: 'Funciona em português?',
    a: 'A Norya nasceu para o chat brasileiro. Gíria, meme e emote fazem parte da análise, e os resumos saem em português.',
  },
  {
    q: 'O que exatamente é analisado?',
    a: 'As mensagens públicas do chat durante a live: sentimento, assuntos, palavras-chave, menções a marcas e picos de atividade.',
  },
  {
    q: 'Consigo ver lives passadas?',
    a: 'Sim. O histórico completo fica disponível: navegue por dia, recorte trechos, peça resumos e gere o relatório de qualquer período.',
  },
  {
    q: 'Como a análise conhece o meu nicho?',
    a: 'No cadastro você indica categoria, jogos e marcas. O contexto do seu nicho entra automaticamente nas análises do seu canal.',
  },
  {
    q: 'Quanto tempo leva para começar?',
    a: 'Dois cliques: entrar com a conta da plataforma e escolher o canal. Na live seguinte, o painel já está acompanhando.',
  },
] as const;

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[1200px] scroll-mt-24 border-t border-white/[0.07] px-5 py-32">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-400">Perguntas</p>
      <div className="mt-12 grid gap-x-16 gap-y-12 md:grid-cols-2">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={(i % 2) * 90 + Math.floor(i / 2) * 60}>
          <div className="grid grid-cols-[40px_1fr] gap-4">
            <span className="font-mono text-xs text-accent-300/70">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3 className="text-[15px] font-semibold text-ink-800">{f.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-400">{f.a}</p>
            </div>
          </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─── CTA final (a anotação da Norya, falando com você) ─────────────────────

function FinalCta() {
  return (
    <section className="border-t border-white/[0.07] px-5 py-36">
      <Reveal>
      <div
        className="mx-auto w-full max-w-lg rounded-2xl border border-accent-400/30 bg-bg-1/95 p-8 shadow-elevated"
        style={{ backdropFilter: 'blur(16px)' }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent-300">
          norya · agora
        </p>
        <p className="mt-3 text-2xl font-bold leading-snug tracking-[-0.01em] text-ink-800">
          Sua audiência está falando neste exato momento.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          Conecte o canal e comece a ouvir. A primeira análise sai na sua próxima live.
        </p>
        <div className="mt-7 flex items-center gap-5">
          <Link
            href="/signup"
            className="rounded-full bg-accent-400 px-6 py-3 text-sm font-semibold text-bg-0 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(215,254,1,0.22)]"
          >
            Criar conta gratuita
          </Link>
          <Link href="/login" className="text-sm text-ink-400 underline-offset-4 transition-colors hover:text-ink-700 hover:underline">
            Já tenho conta
          </Link>
        </div>
      </div>
      </Reveal>
    </section>
  );
}

// ─── Footer (colunas) ──────────────────────────────────────────────────────

const FOOTER_COLS = [
  {
    title: 'Produto',
    links: [
      { label: 'Recursos', href: '#recursos' },
      { label: 'Casos de uso', href: '#casos-de-uso' },
      { label: 'Perguntas', href: '#faq' },
    ],
  },
  {
    title: 'Conta',
    links: [
      { label: 'Entrar', href: '/login' },
      { label: 'Criar conta', href: '/signup' },
    ],
  },
  {
    title: 'Plataformas',
    links: [
      { label: 'Twitch', href: '/signup' },
      { label: 'Kick', href: '/signup' },
    ],
  },
] as const;

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-16">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <span className="text-lg font-bold tracking-tight text-ink-800">
            Norya<span className="text-accent-400">.</span>
          </span>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-400">
            Social listening em tempo real pra lives na Twitch e na Kick. O chat
            inteiro, lido e traduzido enquanto a live acontece.
          </p>
        </div>
        {FOOTER_COLS.map((col) => (
          <div key={col.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-500">{col.title}</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.href.startsWith('#') ? (
                    <a href={l.href} className="text-sm text-ink-400 transition-colors hover:text-ink-800">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="text-sm text-ink-400 transition-colors hover:text-ink-800">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-12 flex max-w-[1200px] flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-5 pt-6">
        <span className="font-mono text-xs text-ink-400/60">
          © {new Date().getFullYear()} norya.io · feito pra quem vive de live.
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-400/60">pt-BR</span>
      </div>
    </footer>
  );
}
