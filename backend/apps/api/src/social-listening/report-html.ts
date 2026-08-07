/**
 * buildReportHtml — relatório da live em layout "bento grid" editorial
 * (fundo claro com gradiente pastel, tipografia display, métricas e análise
 * em caixas), renderizado em PDF pelo HtmlPdfRendererService (Chromium).
 * Pensado para ser entregue a marcas/patrocinadores: menos parágrafos,
 * tópicos pontuados dentro de caixas.
 *
 * Cores vêm do design system do console (tailwind.config do front):
 * lime #d7fe01 (accent), ink #07090c, pastéis pal-* nas caixas de tópico.
 *
 * EMOTES aparecem como imagem (<img> dos CDNs), tanto os do dicionário
 * (Twitch/BTTV/FFZ/7TV) quanto os nativos do Kick citados no chat.
 *
 * Funções puras e síncronas — nada de rede aqui; as imagens (e a fonte
 * Satoshi, via fontshare) são carregadas pelo próprio Chromium na hora do
 * print (com timeout — ver renderer; sem rede, cai na pilha Helvetica).
 *
 * As 3 páginas têm altura FIXA (A4 sem margem, rodapé próprio) com
 * overflow escondido — todo conteúdo variável é limitado (slice/clamp)
 * para nunca estourar página.
 */
import type { ReportData } from './insights-report.service';

export interface ReportEmote {
  code: string;
  url: string;
}

/** Escapa HTML — todo texto vindo do chat/IA passa por aqui antes do markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converte texto em HTML com emotes como <img>. Duas passadas:
 *   1. marcador nativo Kick `[emote:ID:NOME]` → img direto pelo ID;
 *   2. palavra inteira presente no dicionário → img do CDN.
 * O texto é escapado ANTES do markup — emote code nunca vira vetor de XSS.
 */
export function emotesToHtml(text: string, emotes: Map<string, ReportEmote>): string {
  const kickRe = /\[emote:(\d+):([^\]]+)\]/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = kickRe.exec(text)) !== null) {
    if (m.index > last) parts.push(wordsToHtml(text.slice(last, m.index), emotes));
    const [, id, name] = m;
    parts.push(emoteImg(`https://files.kick.com/emotes/${id}/fullsize`, name!));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(wordsToHtml(text.slice(last), emotes));
  return parts.join('');
}

function wordsToHtml(text: string, emotes: Map<string, ReportEmote>): string {
  return text
    .split(/(\s+)/)
    .map((tok) => {
      const e = emotes.get(tok);
      if (e) return emoteImg(e.url, e.code);
      // A narrativa da IA cita emotes entre aspas/pontuação ("'emojiAngry',");
      // tenta de novo sem a pontuação das bordas, preservando-a no output.
      const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(tok);
      const core = m?.[2] ? emotes.get(m[2]) : undefined;
      return core
        ? `${escapeHtml(m![1]!)}${emoteImg(core.url, core.code)}${escapeHtml(m![3]!)}`
        : escapeHtml(tok);
    })
    .join('');
}

function emoteImg(url: string, code: string): string {
  return `<img class="emote" src="${escapeHtml(url)}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}">`;
}

/**
 * Texto de bullet/resumo com marcação leve da IA: '# Rótulo: ...' vira
 * <b>Rótulo:</b> e '#hashtag' vira negrito — o '#' cru no PDF parecia defeito.
 * Emotes continuam virando imagem (cada segmento passa pelo emotesToHtml).
 */
export function richText(text: string, emotes: Map<string, ReportEmote>): string {
  let body = text.trim();
  let head = '';
  const heading = /^#+\s*([^:#]{1,60}):\s*/.exec(body);
  if (heading) {
    head = `<b>${emotesToHtml(`${heading[1]!.trim()}:`, emotes)}</b> `;
    body = body.slice(heading[0].length);
  } else {
    body = body.replace(/^#+\s*/, '');
  }
  const parts = body
    .split(/(#[\p{L}\p{N}_-]+)/gu)
    .map((seg) => (seg.startsWith('#') ? `<b>${escapeHtml(seg)}</b>` : emotesToHtml(seg, emotes)));
  return head + parts.join('');
}

// ── Formatação ───────────────────────────────────────────────────────────────
const MESES = {
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
} as const;

type ReportLang = 'pt' | 'en';

/** Componentes da data no fuso pedido (tz ausente → fuso do servidor). */
function dateParts(d: Date, tz?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    y: get('year'),
    m: Number(get('month')),
    d: get('day'),
    hh: get('hour'),
    mm: get('minute'),
  };
}

function fmtLong(d: Date, tz?: string, lang: ReportLang = 'pt'): string {
  const p = dateParts(d, tz);
  return `${Number(p.d)} ${MESES[lang][p.m - 1]} ${p.y}`;
}

// Só dia/mês — hora fica de fora do relatório (pedido de produto).
function fmtPeak(d: Date, tz?: string): string {
  const p = dateParts(d, tz);
  return `${p.d}/${String(p.m).padStart(2, '0')}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Texto corrido → bullets: remove marcação markdown residual (`**`) e quebra
 * em frases. Usado no insight do pico e nas narrativas antigas/template sem
 * `topicos` estruturados.
 */
function splitBullets(text: string, max: number): string[] {
  return text
    .replace(/\*\*/g, '')
    .replace(/^\s*insight:\s*/i, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** Tag da caixa de tópico quando a narrativa (antiga/template) não traz uma. */
function guessTag(titulo: string): string {
  const t = titulo.toLowerCase();
  if (t.includes('sentiment') || t.includes('clima')) return 'sentimento';
  if (t.includes('pauta') || t.includes('conversa')) return 'conversas';
  if (t.includes('destaque') || t.includes('momento')) return 'momentos';
  if (t.includes('marca')) return 'marcas';
  if (t.includes('público') || t.includes('audiência') || t.includes('engaj')) return 'audiência';
  return 'análise';
}

/**
 * Toxicidade/moderação está FORA do relatório (decisão de produto): nenhuma
 * caixa, card ou menção. Filtro defensivo — vale para narrativas da IA,
 * template e narrativas antigas.
 */
const TOX_RE = /toxic|modera|atrito/i;

/** Token de keyword que na verdade é um emote nativo do Kick (com/sem colchetes). */
const KICK_TOKEN_RE = /^\[?emote:(\d+):([^\]]+)\]?$/;

// ── Blocos ───────────────────────────────────────────────────────────────────

function bars(
  rows: Array<{ label: string; value: number }>,
  opts: { suffix?: string; emotes?: Map<string, ReportEmote> } = {},
): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bars">${rows
    .map((r) => {
      const label = opts.emotes ? emotesToHtml(r.label, opts.emotes) : escapeHtml(r.label);
      return (
        `<div class="bar-row">` +
        `<span class="bar-label">${label}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${Math.max(4, Math.round((r.value / max) * 100))}%"></span></span>` +
        `<span class="bar-val">${r.value}${opts.suffix ?? ''}</span>` +
        `</div>`
      );
    })
    .join('')}</div>`;
}

/** Chip de palavra-chave com contagem; emotes (dict ou kick) viram imagem. */
function keywordChip(word: string, count: number, emotes: Map<string, ReportEmote>): string {
  const kick = KICK_TOKEN_RE.exec(word);
  const label = kick
    ? emoteImg(`https://files.kick.com/emotes/${kick[1]}/fullsize`, kick[2]!)
    : emotesToHtml(word, emotes);
  return `<span class="chip">${label}<i>${count}</i></span>`;
}

/** Pastéis do design system (tailwind `pal-*`), rotacionados nas caixas. */
const PASTEIS = ['#cdeefc', '#c5bff7', '#f7b3f3', '#fcafc8', '#c2f0b0', '#fde5b4'];

/**
 * Wordmark "norya" full preto (ref/preto full.svg) embutido como data URI —
 * o Chromium do renderer não depende de rede/filesystem pra pintar o topo.
 */
const NORYA_LOGO_BLACK =
  'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMiIgZGF0YS1uYW1lPSJMYXllciAyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMTEuNTYgMjcuNTYiPgogIDxnIGlkPSJMYXllcl8xLTIiIGRhdGEtbmFtZT0iTGF5ZXIgMSI+CiAgICA8Zz4KICAgICAgPHBhdGggZD0iTTMwLjgxLDUuMTFoNC43NGw2LjQ2LDkuOTlWNS4xMWg0Ljg3djE3LjY2aC00Ljc3bC02LjQzLTkuOTl2OS45OWgtNC44N1Y1LjExWiIvPgogICAgICA8cGF0aCBkPSJNNDcuNzgsMTMuOTRjMC01LjA3LDMuOTgtOS4xOCw5LjA4LTkuMThzOS4wOCw0LjE0LDkuMDgsOS4xOC0zLjk5LDkuMTgtOS4wOCw5LjE4LTkuMDgtNC4xNC05LjA4LTkuMThaTTYwLjk1LDEzLjk0YzAtMi43NS0xLjg0LTQuNjItNC4wOS00LjYycy00LjA5LDEuODctNC4wOSw0LjYyLDEuODcsNC42Miw0LjA5LDQuNjIsNC4wOS0xLjg3LDQuMDktNC42MloiLz4KICAgICAgPHBhdGggZD0iTTY2Ljg2LDUuMTFoOC4wN2MzLjg4LDAsNi41MSwyLjU3LDYuNTEsNi4wMywwLDIuMTctMS4yMSwzLjk2LTMuMjUsNC45OWwzLjkzLDYuNjNoLTUuNTVsLTMuMjMtNS42MmgtMS40OXY1LjYyaC00Ljk5VjUuMTFaTTc0LjI1LDEzLjE2YzEuMjYsMCwyLjA5LS44MSwyLjA5LTEuOTdzLS44My0xLjk3LTIuMDktMS45N2gtMi41N3YzLjkzaDIuNTdaIi8+CiAgICAgIDxwYXRoIGQ9Ik04Ni4zMSwxNi42N2wtNS44NS0xMS41NWg1LjQ1bDMsNi40NiwyLjk4LTYuNDZoNS4yN2wtNS44NSwxMS41NXY2LjFoLTQuOTl2LTYuMVoiLz4KICAgICAgPHBhdGggZD0iTTEwMC4wOCw1LjExaDUuMDJsNi40NiwxNy42NmgtNS4zbC0uOTgtMy4yNWgtNS41NWwtLjk4LDMuMjVoLTUuMTJsNi40Ni0xNy42NlpNMTA0LjIyLDE1LjQzbC0xLjcxLTUuNC0xLjcyLDUuNGgzLjQzWiIvPgogICAgPC9nPgogICAgPHBhdGggZD0iTTI0LjIzLDE0LjI0bDMuMzQtMi4xNmMtLjA1LTIuMS0xLjg5LTIuNjYtMy42OS0yLjQ3LDEuNDItMS4xNCwyLjMzLTIuOS44MS00LjRsLTIuMTEsMi4xMWMtLjQ2LjQ2LTEuMjMuMDMtMS4wOS0uNmwuODQtMy44OGgtLjAxYy0xLjUxLTEuNDQtMy4yMy0uNTMtNC4zNS44Ni4xOC0xLjg1LS4zOC0zLjY3LTIuNTMtMy43djNjMCwuNjUtLjg0Ljg5LTEuMTkuMzVsLTIuMTYtMy4zNWMtMi4xMi4wNS0yLjY3LDEuODktMi40OCwzLjctMS4xNy0xLjQ0LTIuODUtMi4zMS00LjQtLjgybDIuMTIsMi4xMWMuNDUuNDYuMDMsMS4yMy0uNiwxLjA5bC0zLjg4LS44NGMtMS40NSwxLjUtLjU1LDMuMjQuODUsNC4zNy0xLjg0LS4xOC0zLjY2LjM5LTMuNjksMi41M2gyLjk5Yy42NSwwLC45Ljg0LjM1LDEuMmwtMy4zNCwyLjE0Yy4wNSwyLjExLDEuODgsMi42NywzLjY5LDIuNDgtMS40MiwxLjE0LTIuMzMsMi45LS44MSw0LjRsMi4xMS0yLjExYy40Ni0uNDYsMS4yMy0uMDQsMS4wOS41OWwtLjg0LDMuODhjMS41LDEuNDYsMy4yMy41NCw0LjM1LS44NS0uMTgsMS44NC4zOCwzLjY2LDIuNTQsMy42OXYtMi45OWMwLS42NS44NC0uOSwxLjE5LS4zNWwyLjE2LDMuMzRjMi4xMi0uMDcsMi42NS0xLjg3LDIuNDctMy42OSwxLjE2LDEuNDMsMi44OCwyLjMyLDQuNC44MmwtMi4xMS0yLjExYy0uNDYtLjQ2LS4wMy0xLjI0LjYtMS4wOWwzLjg4LjgzaC4wMWMxLjQ0LTEuNTEuNTMtMy4yMy0uODYtNC4zNSwxLjg1LjE4LDMuNjYtLjM5LDMuNjktMi41NGgtMi45OWMtLjY2LDAtLjktLjg0LS4zNS0xLjE5Wk0yMS43MiwxMy4zNGwtMy4zNSwyLjE2YzAsMS4xLjc2LDIuMTEsMS44MywyLjM5LjU4LjQyLjI1LDEuMzQtLjQ4LDEuMiwwLDAtMy45LS44NC0zLjktLjg0LS4wNS4wNS0uMS4xLS4xMy4xNS0uNjguNzctLjc4LDEuOTMtLjI2LDIuODEuMTIuNzEtLjc4LDEuMTQtMS4xOS41MywwLDAtMi4xNy0zLjM1LTIuMTctMy4zNS0xLjEsMC0yLjEyLjc2LTIuMzksMS44My0uNDEuNTgtMS4zNC4yMy0xLjItLjQ5LDAsMCwuODQtMy45Ljg0LTMuOS0uNzgtLjc3LTIuMDItLjk2LTIuOTctLjM5LS43MS4xMi0xLjE0LS43OC0uNTEtMS4xOSwwLDAsMy4zNS0yLjE3LDMuMzUtMi4xNywwLTEuMDktLjc2LTIuMS0xLjgzLTIuMzctLjU4LS40Mi0uMjUtMS4zNi40OC0xLjIsMCwwLDMuOS44MywzLjkuODMuNzctLjc4Ljk2LTIuMDIuMzktMi45Ny0uMTItLjcxLjc4LTEuMTQsMS4xOS0uNTEsMCwwLDIuMTcsMy4zNSwyLjE3LDMuMzUsMS4wOSwwLDIuMTEtLjc3LDIuMzctMS44My40Mi0uNTgsMS4zNi0uMjQsMS4yLjQ4LDAsMC0uODMsMy45MS0uODMsMy45MS43OC43OCwyLjA0Ljk1LDIuOTkuMzguNy0uMTEsMS4xMS43OS40OSwxLjJaIi8+CiAgPC9nPgo8L3N2Zz4=';

/** Rótulos estáticos do relatório, por idioma. */
const STR = {
  pt: {
    docTitle: 'Relatório de comunidade da live',
    footerBrand: 'norya · relatório de comunidade da live',
    heroOver: 'Análise do chat da live',
    activeDays: (n: number) => `${n} dia(s) de atividade`,
    execSummary: 'Resumo <i>executivo</i>',
    periodNumbers: 'Números <i>do período</i>',
    messages: 'Mensagens',
    perActiveDay: (v: string) => `${v}/dia ativo`,
    peakUsers: 'Pico de usuários',
    uniqueInWindow: 'únicos numa janela',
    windows: 'Janelas',
    analyzed: 'analisadas',
    peakPerWindow: 'Pico / janela',
    noPeakShort: 'sem pico destacado',
    sentiment: 'Sentimento geral',
    positive: 'Positivo',
    neutral: 'Neutro',
    negative: 'Negativo',
    highlight: 'Destaque',
    messagesAt: (when: string) => `mensagens · ${when}`,
    noPeakPeriod: 'sem pico no período',
    peakTitle: 'O que aconteceu no <em>pico</em>',
    noPeakTitle: 'Sem pico de engajamento destacado no período',
    peakFallback: (w: number, avg: string, users: string) =>
      `${w} janelas analisadas · ${avg} mensagens/dia ativo · ${users} usuários no pico.`,
    convMeta: 'conversas',
    convRule: 'Conversas <i>o que moveu o chat</i>',
    topCategories: 'Pautas mais comentadas',
    keywords: 'Palavras-chave',
    brands: 'Marcas mencionadas',
    noBrands: 'Sem menções comerciais diretas no período.',
    topEmotes: 'Emotes em destaque',
    chatVoices: 'Vozes do chat',
    topicsMeta: 'tópicos',
    topicsRule: 'Tópicos <i>abordados na live</i>',
    analysisTag: 'análise',
    closingTag: 'Inteligência de comunidade para criadores, marcas e patrocinadores.',
    closingCta: 'Relatório gerado automaticamente a partir do chat da live',
  },
  en: {
    docTitle: 'Live community report',
    footerBrand: 'norya · live community report',
    heroOver: 'Live chat analysis',
    activeDays: (n: number) => `${n} active day(s)`,
    execSummary: 'Executive <i>summary</i>',
    periodNumbers: 'Period <i>numbers</i>',
    messages: 'Messages',
    perActiveDay: (v: string) => `${v}/active day`,
    peakUsers: 'Peak users',
    uniqueInWindow: 'unique in a window',
    windows: 'Windows',
    analyzed: 'analyzed',
    peakPerWindow: 'Peak / window',
    noPeakShort: 'no standout peak',
    sentiment: 'Overall sentiment',
    positive: 'Positive',
    neutral: 'Neutral',
    negative: 'Negative',
    highlight: 'Highlight',
    messagesAt: (when: string) => `messages · ${when}`,
    noPeakPeriod: 'no peak in the period',
    peakTitle: 'What happened at the <em>peak</em>',
    noPeakTitle: 'No standout engagement peak in the period',
    peakFallback: (w: number, avg: string, users: string) =>
      `${w} windows analyzed · ${avg} messages/active day · ${users} users at the peak.`,
    convMeta: 'conversations',
    convRule: 'Conversations <i>what moved the chat</i>',
    topCategories: 'Most discussed topics',
    keywords: 'Keywords',
    brands: 'Brands mentioned',
    noBrands: 'No direct commercial mentions in the period.',
    topEmotes: 'Top emotes',
    chatVoices: 'Chat voices',
    topicsMeta: 'topics',
    topicsRule: 'Topics <i>covered in the live</i>',
    analysisTag: 'analysis',
    closingTag: 'Community intelligence for creators, brands and sponsors.',
    closingCta: 'Report generated automatically from the live chat',
  },
} as const;

// ── Documento ────────────────────────────────────────────────────────────────

export function buildReportHtml(data: ReportData, emoteList: ReportEmote[]): string {
  const emotes = new Map(emoteList.map((e) => [e.code, e]));
  const m = data.metrics;
  const lang: ReportLang = data.lang ?? 'pt';
  const t = STR[lang];
  const avgPerDay = m.activeDays ? Math.round(m.totalMessages / m.activeDays) : m.totalMessages;

  const topicos = (
    data.narrative.topicos?.length
      ? data.narrative.topicos
      : data.narrative.secoes.map((s) => ({
          titulo: s.titulo,
          tag: guessTag(s.titulo),
          bullets: splitBullets(s.corpo, 4),
        }))
  )
    .filter((t) => t.titulo && t.bullets.length)
    .filter((t) => !TOX_RE.test(`${t.tag} ${t.titulo}`))
    .map((t) => ({ ...t, bullets: t.bullets.filter((b) => !TOX_RE.test(b)) }))
    .filter((t) => t.bullets.length)
    .slice(0, 6);

  const quotes = (data.narrative.quotes ?? []).slice(0, 3);
  const peakBullets = data.peakInsight ? splitBullets(data.peakInsight, 3) : [];

  // Emotes em destaque: keywords que resolvem para imagem (dicionário ou Kick).
  const emoteHighlights = m.topKeywords
    .map((k) => {
      const kick = KICK_TOKEN_RE.exec(k.word);
      if (kick) {
        return {
          url: `https://files.kick.com/emotes/${kick[1]}/fullsize`,
          code: kick[2]!,
          count: k.count,
        };
      }
      const e = emotes.get(k.word);
      return e ? { url: e.url, code: e.code, count: k.count } : null;
    })
    .filter((e): e is { url: string; code: string; count: number } => e !== null)
    .slice(0, 3);

  const footer = (n: number) =>
    `<div class="pfoot"><span>${t.footerBrand}</span><span>${escapeHtml(
      data.channelName,
    )} — 0${n} / 03</span></div>`;

  const topbar = (meta: string) =>
    `<div class="topbar"><img class="brand-logo" src="${NORYA_LOGO_BLACK}" alt="norya"><div class="topmeta">${meta}</div></div>`;

  // ── Página 2: caixas de "Conversas" (span2 cada; a última vira span4 se ímpar)
  const convTiles: string[] = [];
  if (m.topCategories.length) {
    convTiles.push(
      `<div class="tile"><p class="k">${t.topCategories}</p>${bars(
        m.topCategories.slice(0, 6).map((c) => ({ label: c.category, value: c.count })),
      )}</div>`,
    );
  }
  if (m.topKeywords.length) {
    convTiles.push(
      `<div class="tile"><p class="k">${t.keywords}</p><div class="chips">${m.topKeywords
        .slice(0, 12)
        .map((k) => keywordChip(k.word, k.count, emotes))
        .join('')}</div></div>`,
    );
  }
  // Marcas: sempre presente — a ausência de menções também é informação
  // relevante para um patrocinador.
  convTiles.push(
    `<div class="tile"><p class="k">${t.brands}</p>${
      m.brands.length
        ? bars(m.brands.slice(0, 5).map((b) => ({ label: b.brand, value: b.count })))
        : `<p class="empty">${t.noBrands}</p>`
    }</div>`,
  );
  if (emoteHighlights.length) {
    convTiles.push(
      `<div class="tile"><p class="k">${t.topEmotes}</p>${emoteHighlights
        .map(
          (e) =>
            `<div class="emote-row"><img class="emote-big" src="${escapeHtml(e.url)}" alt="${escapeHtml(e.code)}">` +
            `<span class="emote-code">${escapeHtml(e.code)}</span><span class="emote-count">${e.count}×</span></div>`,
        )
        .join('')}</div>`,
    );
  }
  if (quotes.length) {
    convTiles.push(
      `<div class="tile"><p class="k">${t.chatVoices}</p>${quotes
        .map(
          (q) =>
            `<div class="quote"><p class="q-text">&ldquo;${emotesToHtml(q.text, emotes)}&rdquo;</p>` +
            `<p class="q-user">@${escapeHtml(q.user)}</p></div>`,
        )
        .join('')}</div>`,
    );
  }
  const convGrid = convTiles
    .map((t, i) => {
      const span4 = convTiles.length % 2 === 1 && i === convTiles.length - 1;
      return t.replace('<div class="tile">', `<div class="tile ${span4 ? 'span4' : 'span2'}">`);
    })
    .join('');

  // ── Página 3: tópicos em caixas pastel (nº ímpar → última caixa vira full-width)
  // 5+ caixas não cabem na altura fixa da página com 4 bullets de 3 linhas
  // cada — o modo denso corta para 3 bullets de até 2 linhas.
  const denseTopics = topicos.length > 4;
  const maxBullets = denseTopics ? 3 : 4;
  const topicCards = topicos
    .map((tp, i) => {
      const wide = topicos.length % 2 === 1 && i === topicos.length - 1;
      return (
        `<div class="topic${wide ? ' wide' : ''}" style="background:${PASTEIS[i % PASTEIS.length]}">` +
        `<div class="topic-head"><span class="topic-tag">${escapeHtml(tp.tag || t.analysisTag)}</span><h3>${escapeHtml(tp.titulo)}</h3></div>` +
        `<ul>${tp.bullets
          .slice(0, maxBullets)
          .map((b) => `<li>${richText(b, emotes)}</li>`)
          .join('')}</ul></div>`
      );
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'pt-BR'}">
<head>
<meta charset="utf-8">
<style>
@import url('https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700,900&display=swap');

:root {
  --ink: #07090c; --ink-70: rgba(11,17,24,.72); --ink-55: rgba(11,17,24,.55);
  --ink-40: rgba(11,17,24,.40); --line: rgba(15,23,32,.10); --line-strong: rgba(15,23,32,.85);
  --lime: #d7fe01; --lime-deep: #a8c800; --olive: #5e7d00;
  --pos: #1f9d6b; --neu: #cfd5db; --negc: #dd5a4f;
  --tile: rgba(255,255,255,.78);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4; margin: 0; }
html, body { font-family: 'Satoshi', Helvetica, Arial, sans-serif; color: var(--ink); }
img.emote { height: 1.2em; width: auto; vertical-align: text-bottom; }

.page {
  width: 794px; height: 1123px; overflow: hidden; position: relative;
  padding: 46px 46px 70px; page-break-after: always;
  display: flex; flex-direction: column;
  background:
    radial-gradient(600px 400px at 88% -70px, rgba(197,191,247,.50), transparent 70%),
    radial-gradient(520px 340px at 8% -90px, rgba(252,175,200,.34), transparent 70%),
    radial-gradient(460px 320px at 52% 4%, rgba(205,238,252,.45), transparent 72%),
    radial-gradient(300px 230px at 96% 26%, rgba(215,254,1,.20), transparent 70%),
    #f6f7f9;
}
.page + .page {
  background:
    radial-gradient(480px 300px at 92% -80px, rgba(205,238,252,.40), transparent 70%),
    radial-gradient(420px 280px at 4% -70px, rgba(197,191,247,.30), transparent 70%),
    #f7f8fa;
}

/* topo */
.topbar { display: flex; justify-content: space-between; align-items: center; flex: 0 0 auto; }
.brand-logo { height: 17px; width: auto; display: block; }
.topmeta { font-size: 9px; font-weight: 700; letter-spacing: 2.2px; text-transform: uppercase; color: var(--ink-55); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* herói */
.hero { margin-top: 54px; }
.hero .over { font-size: 11px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--olive); }
.hero h1 { font-size: 72px; font-weight: 900; line-height: .96; letter-spacing: -2.5px; text-transform: uppercase; overflow-wrap: anywhere; max-height: 140px; overflow: hidden; }
.hero .period { display: flex; align-items: center; gap: 12px; margin-top: 16px; font-size: 12.5px; font-weight: 500; color: var(--ink-70); }
.hero .period::before { content: ''; width: 34px; height: 4px; background: var(--lime); }

/* régua editorial */
.rule { border-top: 1.5px solid var(--line-strong); margin-top: 30px; padding-top: 12px; flex: 0 0 auto; }
.rule .lbl { font-size: 9.5px; font-weight: 900; letter-spacing: 2.4px; text-transform: uppercase; }
.rule .lbl i { font-style: normal; color: var(--olive); }
.lead { font-size: 12.5px; line-height: 1.6; color: var(--ink-70); margin-top: 10px; max-width: 700px; display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden; }

/* bento */
.bento { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 16px; }
.tile { background: var(--tile); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }
.tile .k { font-size: 8.5px; font-weight: 900; letter-spacing: 1.6px; text-transform: uppercase; color: var(--ink-55); }
.tile .v { font-size: 42px; font-weight: 900; letter-spacing: -1px; margin-top: 10px; line-height: 1; }
.tile .s { font-size: 9px; color: var(--ink-55); margin-top: 8px; }
.tile .empty { font-size: 10.5px; color: var(--ink-55); margin-top: 14px; }
.tile.dark { background: var(--ink); border-color: var(--ink); color: #fff; }
.tile.dark .k { color: rgba(255,255,255,.55); }
.tile.dark .v { color: var(--lime); }
.tile.dark .s { color: rgba(255,255,255,.5); }
.tile.lime { background: var(--lime); border-color: var(--lime); }
.tile.lime .k { color: rgba(11,17,24,.6); }
.span2 { grid-column: span 2; }
.span4 { grid-column: span 4; }

/* sentimento */
.senti-bar { display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: #e9ecef; margin-top: 12px; }
.senti-legend { display: flex; gap: 18px; margin-top: 10px; font-size: 10px; font-weight: 500; color: var(--ink-70); }
.senti-legend span { display: flex; align-items: center; gap: 6px; }
.dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }

/* pico (dark wide) */
.peak-flex { display: flex; gap: 26px; align-items: flex-start; }
.peak-num { min-width: 150px; }
.peak-num .v { font-size: 56px; }
.peak-body h3 { font-size: 14px; font-weight: 900; margin-bottom: 8px; }
.peak-body h3 em { font-style: normal; color: var(--lime); }
ul.lime-list { list-style: none; }
ul.lime-list li { position: relative; padding-left: 16px; font-size: 10.5px; line-height: 1.5; color: rgba(255,255,255,.82); margin-top: 5px; }
ul.lime-list li::before { content: ''; position: absolute; left: 0; top: 6px; width: 8px; height: 3px; background: var(--lime); }

/* barras */
.bars { margin-top: 4px; }
.bar-row { display: flex; align-items: center; gap: 10px; margin-top: 11px; }
.bar-label { width: 118px; font-size: 9.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { flex: 1; height: 12px; border-radius: 6px; background: rgba(15,23,32,.07); overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 6px; background: var(--lime); border-right: 2px solid var(--lime-deep); }
.bar-val { width: 34px; text-align: right; font-size: 10px; font-weight: 900; }

/* chips */
.chips { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 16px; max-height: 176px; overflow: hidden; }
.chip { display: inline-flex; align-items: center; gap: 6px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 7px 12px; font-size: 10.5px; font-weight: 500; }
.chip i { font-style: normal; font-weight: 900; font-size: 8.5px; color: var(--olive); }

/* citações */
.quote { border-left: 3px solid var(--lime); padding: 2px 0 2px 12px; margin-top: 16px; }
.q-text { font-size: 11.5px; font-weight: 500; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.q-user { font-size: 9px; font-weight: 700; color: var(--ink-55); margin-top: 4px; }

/* emotes em destaque */
.emote-row { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
.emote-big { height: 34px; width: auto; }
.emote-code { font-size: 13px; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.emote-count { margin-left: auto; font-size: 15px; font-weight: 900; color: var(--olive); }

/* página 2 — cards respirados */
.p2 .bento { gap: 14px; margin-top: 18px; }
.p2 .tile { min-height: 236px; padding: 22px; }

/* tópicos (bento pastel) */
.topics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; flex: 1 1 auto; overflow: hidden; align-content: start; }
.topic { border-radius: 18px; padding: 20px 22px; border: 1px solid rgba(15,23,32,.12); }
.topic.wide { grid-column: 1 / -1; }
.topic-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.topic-tag { background: var(--ink); color: #fff; font-size: 8px; font-weight: 900; letter-spacing: 1.4px; text-transform: uppercase; border-radius: 9px; padding: 4px 9px; white-space: nowrap; }
.topic h3 { font-size: 14.5px; font-weight: 900; letter-spacing: -.2px; }
.topic ul { list-style: none; }
.topic li { position: relative; padding-left: 14px; font-size: 10px; line-height: 1.5; color: var(--ink-70); margin-top: 5px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.topic li::before { content: ''; position: absolute; left: 0; top: 6px; width: 7px; height: 2.5px; background: var(--ink); opacity: .5; }
/* 5+ caixas de tópico: modo denso pra caber na altura fixa da página sem
   cortar caixa no meio (padding menor + bullets em até 2 linhas). */
.topics.dense .topic { padding: 14px 18px; }
.topics.dense .topic li { -webkit-line-clamp: 2; margin-top: 4px; }
.topics.dense .topic-head { margin-bottom: 6px; }

/* fechamento */
.closing { background: var(--ink); border-radius: 18px; padding: 24px 28px; margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 30px; flex: 0 0 auto; }
.closing .c-brand { color: var(--lime); font-size: 24px; font-weight: 900; letter-spacing: -.5px; }
.closing .c-tag { color: rgba(255,255,255,.75); font-size: 10.5px; margin-top: 6px; max-width: 320px; line-height: 1.5; }
.closing .c-cta { color: rgba(255,255,255,.45); font-size: 8.5px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; text-align: right; }

/* rodapé */
.pfoot { position: absolute; left: 46px; right: 46px; bottom: 28px; border-top: 1px solid var(--line); padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--ink-40); }
.pfoot span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
</head>
<body>

<!-- ═══ PÁGINA 1 — herói + números ═══ -->
<div class="page">
  ${topbar(t.docTitle)}

  <div class="hero">
    <p class="over">${t.heroOver}</p>
    <h1>${escapeHtml(data.channelName)}</h1>
    <p class="period">${fmtLong(data.from, data.tz, lang)} — ${fmtLong(data.to, data.tz, lang)} &nbsp;·&nbsp; ${t.activeDays(m.activeDays)}</p>
  </div>

  <div class="rule"><p class="lbl">${t.execSummary}</p></div>
  <p class="lead">${richText(data.narrative.resumoExecutivo, emotes)}</p>

  <div class="rule"><p class="lbl">${t.periodNumbers}</p></div>
  <div class="bento">
    <div class="tile dark"><p class="k">${t.messages}</p><p class="v">${compact(m.totalMessages)}</p><p class="s">${t.perActiveDay(compact(avgPerDay))}</p></div>
    <div class="tile"><p class="k">${t.peakUsers}</p><p class="v">${compact(m.peakUsers)}</p><p class="s">${t.uniqueInWindow}</p></div>
    <div class="tile"><p class="k">${t.windows}</p><p class="v">${m.windows}</p><p class="s">${t.analyzed}</p></div>
    <div class="tile lime"><p class="k">${t.peakPerWindow}</p><p class="v">${m.peak ? compact(m.peak.messages) : '—'}</p><p class="s">${m.peak ? fmtPeak(m.peak.at, data.tz) : t.noPeakShort}</p></div>

    <div class="tile span4">
      <p class="k">${t.sentiment}</p>
      <div class="senti-bar">
        <span style="width:${pct(m.sentiment.pos)};background:var(--pos)"></span>
        <span style="width:${pct(m.sentiment.neu)};background:var(--neu)"></span>
        <span style="width:${pct(m.sentiment.neg)};background:var(--negc)"></span>
      </div>
      <div class="senti-legend">
        <span><i class="dot" style="background:var(--pos)"></i>${t.positive} ${pct(m.sentiment.pos)}</span>
        <span><i class="dot" style="background:var(--neu)"></i>${t.neutral} ${pct(m.sentiment.neu)}</span>
        <span><i class="dot" style="background:var(--negc)"></i>${t.negative} ${pct(m.sentiment.neg)}</span>
      </div>
    </div>

    <div class="tile dark span4">
      <div class="peak-flex">
        <div class="peak-num"><p class="k">${t.highlight}</p><p class="v">${m.peak ? compact(m.peak.messages) : '—'}</p><p class="s">${m.peak ? t.messagesAt(fmtPeak(m.peak.at, data.tz)) : t.noPeakPeriod}</p></div>
        <div class="peak-body">
          <h3>${m.peak ? t.peakTitle : t.noPeakTitle}</h3>
          ${
            peakBullets.length
              ? `<ul class="lime-list">${peakBullets.map((b) => `<li>${richText(b, emotes)}</li>`).join('')}</ul>`
              : m.peak
                ? `<ul class="lime-list"><li>${t.peakFallback(m.windows, compact(avgPerDay), compact(m.peakUsers))}</li></ul>`
                : ''
          }
        </div>
      </div>
    </div>
  </div>
  ${footer(1)}
</div>

<!-- ═══ PÁGINA 2 — conversas ═══ -->
<div class="page p2">
  ${topbar(`${escapeHtml(data.channelName)} · ${t.convMeta}`)}
  <div class="rule" style="margin-top:40px"><p class="lbl">${t.convRule}</p></div>
  <div class="bento">${convGrid}</div>
  ${footer(2)}
</div>

<!-- ═══ PÁGINA 3 — tópicos da live ═══ -->
<div class="page">
  ${topbar(`${escapeHtml(data.channelName)} · ${t.topicsMeta}`)}
  ${
    topicCards
      ? `<div class="rule" style="margin-top:40px"><p class="lbl">${t.topicsRule}</p></div>
  <div class="topics${denseTopics ? ' dense' : ''}">${topicCards}</div>`
      : ''
  }

  <div class="closing">
    <div>
      <p class="c-brand">norya</p>
      <p class="c-tag">${t.closingTag}</p>
    </div>
    <p class="c-cta">${t.closingCta}</p>
  </div>
  ${footer(3)}
</div>

</body>
</html>`;
}
