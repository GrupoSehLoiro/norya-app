/**
 * buildReportHtml — versão HTML do relatório (mesma estética editorial do
 * ReportPdfService: capa escura + miolo claro + acento lime), renderizada em
 * PDF pelo HtmlPdfRendererService (Chromium). A diferença que motivou a
 * migração: aqui EMOTES aparecem como imagem (<img> dos CDNs), tanto os do
 * dicionário (Twitch/BTTV/FFZ/7TV) quanto os nativos do Kick citados no chat.
 *
 * Funções puras e síncronas — nada de rede aqui; as imagens são carregadas
 * pelo próprio Chromium na hora do print (com timeout — ver renderer).
 */
import type { ReportData, ReportMetrics } from './insights-report.service';

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
      return e ? emoteImg(e.url, e.code) : escapeHtml(tok);
    })
    .join('');
}

function emoteImg(url: string, code: string): string {
  return `<img class="emote" src="${escapeHtml(url)}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}">`;
}

// ── Formatação (espelha o report-pdf) ────────────────────────────────────────
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmtLong(d: Date): string {
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtPeak(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// ── Blocos ───────────────────────────────────────────────────────────────────

function rankedBars(
  rows: Array<{ label: string; value: number }>,
  opts: { suffix?: string; negative?: boolean; emotes?: Map<string, ReportEmote> } = {},
): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const cls = opts.negative ? ' negative' : '';
  return `<div class="bars">${rows
    .map((r) => {
      const label = opts.emotes ? emotesToHtml(r.label, opts.emotes) : escapeHtml(r.label);
      return (
        `<div class="bar-row${cls}">` +
        `<span class="bar-label">${label}</span>` +
        `<span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, Math.round((r.value / max) * 100))}%"></span></span>` +
        `<span class="bar-value">${r.value}${opts.suffix ?? ''}</span>` +
        `</div>`
      );
    })
    .join('')}</div>`;
}

function chips(items: string[], emotes: Map<string, ReportEmote>): string {
  return `<div class="chips">${items
    .map((w) => `<span class="chip">${emotesToHtml(w, emotes)}</span>`)
    .join('')}</div>`;
}

function metricCards(m: ReportMetrics): string {
  const cards: Array<[string, string]> = [
    ['Mensagens', compact(m.totalMessages)],
    ['Dias ativos', String(m.activeDays)],
    ['Pico de usuários', compact(m.peakUsers)],
    ['Pico / janela', m.peak ? compact(m.peak.messages) : '—'],
  ];
  return `<div class="cards">${cards
    .map(
      ([lbl, val]) =>
        `<div class="card"><span class="tick"></span><p class="card-value">${escapeHtml(val)}</p><p class="card-label">${escapeHtml(lbl.toUpperCase())}</p></div>`,
    )
    .join('')}</div>`;
}

// ── Documento ────────────────────────────────────────────────────────────────

export function buildReportHtml(data: ReportData, emoteList: ReportEmote[]): string {
  const emotes = new Map(emoteList.map((e) => [e.code, e]));
  const m = data.metrics;
  const avgPerDay = m.activeDays ? Math.round(m.totalMessages / m.activeDays) : m.totalMessages;

  const secoes = data.narrative.secoes
    .filter((s) => s.titulo || s.corpo)
    .map(
      (s) =>
        `<h3 class="section-title">${escapeHtml(s.titulo)}</h3><p class="body">${emotesToHtml(s.corpo, emotes)}</p>`,
    )
    .join('');

  const methodology = [
    `Análise sobre ${compact(m.totalMessages)} mensagens do chat em ${m.windows} janelas, no período de ${fmtLong(data.from)} a ${fmtLong(data.to)}.`,
    data.generatedByAi
      ? 'Sentimento e pautas classificados automaticamente; texto-síntese assistido por IA e revisável.'
      : 'Sentimento, pautas e texto-síntese gerados automaticamente a partir das métricas do período.',
    data.sampleSize ? `Amostra editorial de ${data.sampleSize} mensagens usada para contexto qualitativo.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  :root {
    --page: #ffffff; --ink: #0c0e10; --ink-sub: #3c434a; --muted: #767c83;
    --faint: #9aa1a8; --hair: #e6e9ec; --card: #f7f8f9; --track: #eceef1;
    --lime: #c8ec00; --lime-pure: #d7fe01; --olive: #5f6b00;
    --pos: #1f9d6b; --neu: #cfd5db; --neg: #dd5a4f; --neg-track: #f6e3e1;
    --hilite-bg: #fbfde8; --hilite-line: #e4f19a;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { font-family: Helvetica, Arial, sans-serif; color: var(--ink-sub); background: var(--page); }
  img.emote { height: 1.25em; width: auto; vertical-align: text-bottom; }

  /* ── Capa (escura) ── */
  .cover {
    background: #0a0d10;
    background-image: radial-gradient(circle 300px at calc(100% - 40px) 90px, rgba(215,254,1,0.14), transparent);
    /* Altura < área útil do A4 (1123px − margens 44+56 ≈ 1023px) — estourar
       1px já vaza uma faixa preta na página seguinte. */
    border-radius: 14px; color: #fff; height: 1008px; position: relative;
    padding: 70px 54px; page-break-after: always;
  }
  .cover .brand { display: flex; align-items: center; gap: 10px; font-weight: bold; font-size: 13px; letter-spacing: 1px; }
  .cover .brand::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--lime-pure); }
  .cover .kicker { color: var(--lime-pure); font-weight: bold; font-size: 8.5px; letter-spacing: 2.4px; margin-top: 14px; }
  .cover .title-block { position: absolute; top: 38%; left: 54px; right: 54px; }
  .cover .subtitle { color: #6a7178; font-size: 11px; letter-spacing: 0.5px; }
  .cover h1 { color: #fff; font-size: 46px; margin-top: 8px; overflow-wrap: anywhere; }
  .cover .rule { width: 40px; height: 3px; background: var(--lime-pure); margin-top: 12px; }
  .cover .range { color: #aeb4ba; font-size: 13px; margin-top: 22px; }
  .cover .foot { position: absolute; left: 54px; right: 54px; bottom: 44px; border-top: 0.75px solid #20272e; padding-top: 14px; display: flex; }
  .cover .foot div { width: 50%; }
  .cover .foot .k { color: #6a7178; font-weight: bold; font-size: 7.5px; letter-spacing: 1.5px; }
  .cover .foot .v { color: #aeb4ba; font-size: 10px; margin-top: 6px; }

  /* ── Miolo claro ── */
  .content { padding: 6px 2px; }
  .eyebrow { display: flex; align-items: center; gap: 8px; color: var(--olive); font-weight: bold; font-size: 9px; letter-spacing: 2px; margin: 26px 0 12px; text-transform: uppercase; }
  .eyebrow::before { content: ''; width: 16px; height: 2.5px; background: var(--lime); }
  .lead { color: var(--ink-sub); font-size: 12px; line-height: 1.55; }
  .label { color: var(--muted); font-weight: bold; font-size: 8px; letter-spacing: 1px; text-transform: uppercase; margin: 16px 0 8px; }
  .section-title { color: var(--ink); font-size: 13px; margin: 18px 0 6px; padding-left: 12px; border-left: 3px solid var(--lime); }
  .body { font-size: 10.5px; line-height: 1.5; }

  .cards { display: flex; gap: 12px; margin: 10px 0 16px; }
  .card { flex: 1; background: var(--card); border: 1px solid var(--hair); border-radius: 10px; padding: 16px 15px; break-inside: avoid; }
  .card .tick { display: block; width: 20px; height: 3px; background: var(--lime); margin-bottom: 10px; }
  .card-value { color: var(--ink); font-weight: bold; font-size: 27px; }
  .card-label { color: var(--muted); font-weight: bold; font-size: 7.5px; letter-spacing: 0.5px; margin-top: 8px; }

  .hilite { background: var(--hilite-bg); border: 1px solid var(--hilite-line); border-left: 4px solid var(--lime); border-radius: 10px; padding: 15px 22px; margin: 6px 0 18px; break-inside: avoid; }
  .hilite .k { color: var(--olive); font-weight: bold; font-size: 8px; letter-spacing: 1.6px; }
  .hilite .v { color: var(--ink); font-weight: bold; font-size: 15px; margin-top: 6px; }
  .hilite .s { color: var(--muted); font-size: 9.5px; margin-top: 8px; }

  .senti-bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; background: var(--track); }
  .senti-bar span { height: 100%; }
  .senti-legend { display: flex; margin: 10px 0 6px; font-size: 9px; }
  .senti-legend span { flex: 1; display: flex; align-items: center; gap: 6px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }

  .bars { margin-bottom: 8px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; break-inside: avoid; }
  .bar-label { width: 128px; font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
  .bar-fill { display: block; height: 100%; border-radius: 5px; background: var(--lime); }
  .bar-row.negative .bar-track { background: var(--neg-track); }
  .bar-row.negative .bar-fill { background: var(--neg); }
  .bar-value { width: 40px; text-align: right; color: var(--ink); font-weight: bold; font-size: 9.5px; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .chip { background: var(--card); border: 1px solid var(--hair); border-radius: 11px; padding: 4px 11px; font-size: 9px; }

  .methodology { border-top: 0.75px solid var(--hair); margin-top: 28px; padding-top: 12px; }
  .methodology .k { color: var(--muted); font-weight: bold; font-size: 7.5px; letter-spacing: 1.5px; }
  .methodology .v { color: var(--faint); font-size: 8.5px; line-height: 1.5; margin-top: 8px; }
</style>
</head>
<body>

<div class="cover">
  <div class="brand">norya</div>
  <div class="kicker">RELATÓRIO DE COMUNIDADE DA LIVE</div>
  <div class="title-block">
    <p class="subtitle">Análise do chat</p>
    <h1>${escapeHtml(data.channelName)}</h1>
    <div class="rule"></div>
    <p class="range">${fmtLong(data.from)} — ${fmtLong(data.to)}</p>
  </div>
  <div class="foot">
    <div><p class="k">PERÍODO</p><p class="v">${m.activeDays} dia(s) de atividade</p></div>
    <div><p class="k">VOLUME ANALISADO</p><p class="v">${compact(m.totalMessages)} mensagens</p></div>
  </div>
</div>

<div class="content">
  <div class="eyebrow">Resumo executivo</div>
  <p class="lead">${emotesToHtml(data.narrative.resumoExecutivo, emotes)}</p>

  ${metricCards(m)}

  <div class="hilite">
    <p class="k">DESTAQUE DO PERÍODO</p>
    <p class="v">${
      m.peak
        ? `Pico de ${compact(m.peak.messages)} mensagens em ${fmtPeak(m.peak.at)}`
        : 'Sem pico de engajamento destacado no período'
    }</p>
    <p class="s">${m.windows} janelas analisadas &nbsp;·&nbsp; ${compact(avgPerDay)} mensagens/dia ativo &nbsp;·&nbsp; ${compact(m.peakUsers)} usuários no pico</p>
  </div>

  ${
    data.peakInsight
      ? `<p class="label">O que aconteceu no pico</p><p class="body">${emotesToHtml(data.peakInsight, emotes)}</p>`
      : ''
  }

  <p class="label">Sentimento geral</p>
  <div class="senti-bar">
    <span style="width:${pct(m.sentiment.pos)};background:var(--pos)"></span>
    <span style="width:${pct(m.sentiment.neu)};background:var(--neu)"></span>
    <span style="width:${pct(m.sentiment.neg)};background:var(--neg)"></span>
  </div>
  <div class="senti-legend">
    <span><i class="dot" style="background:var(--pos)"></i>Positivo ${pct(m.sentiment.pos)}</span>
    <span><i class="dot" style="background:var(--neu)"></i>Neutro ${pct(m.sentiment.neu)}</span>
    <span><i class="dot" style="background:var(--neg)"></i>Negativo ${pct(m.sentiment.neg)}</span>
  </div>

  <div class="eyebrow">Conversas</div>
  ${m.topCategories.length ? `<p class="label">Pautas mais comentadas</p>${rankedBars(m.topCategories.map((c) => ({ label: c.category, value: c.count })))}` : ''}
  ${m.topKeywords.length ? `<p class="label">Palavras-chave</p>${chips(m.topKeywords.map((k) => k.word), emotes)}` : ''}
  ${m.brands.length ? `<p class="label">Marcas mencionadas</p>${rankedBars(m.brands.map((b) => ({ label: b.brand, value: b.count })))}` : ''}
  ${
    m.toxicUsers.length
      ? `<p class="label">Moderação · maior toxicidade</p>${rankedBars(
          m.toxicUsers.map((u) => ({ label: u.username, value: Math.round(u.ratio * 100) })),
          { suffix: '%', negative: true },
        )}`
      : ''
  }

  <div class="eyebrow">Análise</div>
  ${secoes}

  <div class="methodology">
    <p class="k">METODOLOGIA</p>
    <p class="v">${escapeHtml(methodology)}</p>
  </div>
</div>

</body>
</html>`;
}
