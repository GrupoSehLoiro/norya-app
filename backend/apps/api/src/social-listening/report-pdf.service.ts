/**
 * ReportPdfService — renderiza o ReportData num PDF (pdfkit, sem browser).
 *
 * Estética: relatório editorial CLARO (profissional, imprime bem, feito para ser
 * enviado a marcas) com a identidade do console preservada em traços — acento
 * lime em réguas, ticks e barras — e uma CAPA escura (preto + lime + halo) que
 * ecoa o tema do console. Helvetica cobre acentos pt-BR.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ReportData, ReportMetrics } from './insights-report.service';

// ── Paleta ───────────────────────────────────────────────────────────────────
// Miolo claro + acento lime (rebaixado p/ ler no branco). Capa escura à parte.
const PAGE = '#ffffff';
const INK = '#0c0e10'; // títulos
const INK_SUB = '#3c434a'; // corpo
const MUTED = '#767c83'; // rótulos/legendas
const FAINT = '#9aa1a8'; // fininho
const HAIR = '#e6e9ec'; // hairlines/bordas
const CARD = '#f7f8f9'; // fundo de cartão
const TRACK = '#eceef1'; // trilho de barra
const LIME = '#c8ec00'; // acento (fills/ticks/barras)
const LIME_PURE = '#d7fe01'; // acento puro (na capa escura)
const OLIVE = '#5f6b00'; // "lime" legível como texto no claro (eyebrows)
const POS = '#1f9d6b';
const NEU = '#cfd5db';
const NEG = '#dd5a4f';
const NEG_TRACK = '#f6e3e1';
const HILITE_BG = '#fbfde8';
const HILITE_LINE = '#e4f19a';

// Capa escura (identidade do console)
const COVER_BG = '#0a0d10';
const COVER_INK = '#ffffff';
const COVER_SUB = '#aeb4ba';
const COVER_MUTE = '#6a7178';
const COVER_LINE = '#20272e';

const FOOTER_RESERVE = 70;

@Injectable()
export class ReportPdfService {
  async render(data: ReportData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    // Fundo branco em toda página de conteúdo criada depois desta.
    doc.on('pageAdded', () => {
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(PAGE);
      doc.restore();
    });

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const right = left + width;
    const m = data.metrics;

    // ── Capa (escura) ──
    this._cover(doc, data);

    // ── Conteúdo ──
    doc.addPage();

    // Resumo executivo primeiro — conta a história antes dos números.
    eyebrow(doc, 'Resumo executivo', left);
    lead(doc, data.narrative.resumoExecutivo, width);
    doc.moveDown(0.6);

    this._metrics(doc, m, left, width);
    this._highlight(doc, m, left, width);
    if (data.peakInsight) {
      ensureSpace(doc, 60);
      label(doc, 'O que aconteceu no pico', left);
      body(doc, data.peakInsight, width);
      doc.moveDown(0.6);
    }
    this._sentiment(doc, m, left, width);

    // ── Conversas ──
    eyebrow(doc, 'Conversas', left);
    if (m.topCategories.length) {
      label(doc, 'Pautas mais comentadas', left);
      rankedBars(
        doc,
        m.topCategories.map((c) => ({ label: c.category, value: c.count })),
        left,
        width,
      );
    }
    if (m.topKeywords.length) {
      label(doc, 'Palavras-chave', left);
      chips(
        doc,
        m.topKeywords.map((k) => k.word),
        left,
        width,
        right,
      );
    }
    if (m.brands.length) {
      label(doc, 'Marcas mencionadas', left);
      rankedBars(
        doc,
        m.brands.map((b) => ({ label: b.brand, value: b.count })),
        left,
        width,
      );
    }
    if (m.toxicUsers.length) {
      label(doc, 'Moderação · maior toxicidade', left);
      rankedBars(
        doc,
        m.toxicUsers.map((u) => ({ label: u.username, value: Math.round(u.ratio * 100) })),
        left,
        width,
        { suffix: '%', color: NEG, track: NEG_TRACK },
      );
    }

    // ── Análise (IA) ──
    eyebrow(doc, 'Análise', left);
    for (const s of data.narrative.secoes) {
      if (!s.titulo && !s.corpo) continue;
      section(doc, s.titulo, left);
      body(doc, s.corpo, width);
    }

    // ── Metodologia (nota discreta; sem nome de modelo) ──
    this._methodology(doc, data, left, width);

    // ── Rodapé (todas exceto a capa) ──
    const range = doc.bufferedPageRange();
    const contentPages = range.count - 1;
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // rodapé não dispara auto-paginação
      const fy = doc.page.height - 42;
      doc.moveTo(left, fy).lineTo(right, fy).lineWidth(0.75).strokeColor(HAIR).stroke();
      doc.circle(left + 3, fy + 12, 2.2).fill(LIME);
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text(`norya · ${data.channelName}`, left + 12, fy + 8, { lineBreak: false });
      doc
        .fillColor(FAINT)
        .font('Helvetica')
        .fontSize(8)
        .text(`${i} / ${contentPages}`, left, fy + 8, {
          width,
          align: 'right',
          lineBreak: false,
        });
    }

    doc.end();
    return done;
  }

  /** Capa escura: preto + halo lime + título grande, sem ruído técnico. */
  private _cover(doc: PDFKit.PDFDocument, data: ReportData): void {
    const W = doc.page.width;
    const H = doc.page.height;
    const left = doc.page.margins.left;
    const width = W - doc.page.margins.left - doc.page.margins.right;

    doc.rect(0, 0, W, H).fill(COVER_BG);

    // Halo lime suave (canto superior direito) — eco do "led-halo" do console.
    doc.save();
    const halo = doc.radialGradient(W - 40, 90, 0, W - 40, 90, 300);
    halo.stop(0, LIME_PURE, 0.14).stop(1, LIME_PURE, 0);
    doc.rect(0, 0, W, H).fill(halo);
    doc.restore();

    // Wordmark
    const topY = 70;
    doc.circle(left + 4, topY + 5, 4).fill(LIME_PURE);
    doc
      .fillColor(COVER_INK)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('norya', left + 16, topY, { characterSpacing: 1 });
    doc
      .fillColor(LIME_PURE)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('RELATÓRIO DE COMUNIDADE DA LIVE', left, topY + 26, { characterSpacing: 2.4 });

    // Título (bloco central)
    const ty = H * 0.4;
    doc
      .fillColor(COVER_MUTE)
      .font('Helvetica')
      .fontSize(11)
      .text('Análise do chat', left, ty - 26, { characterSpacing: 0.5 });
    doc
      .fillColor(COVER_INK)
      .font('Helvetica-Bold')
      .fontSize(46)
      .text(data.channelName, left, ty, { width, lineGap: 0 });
    doc.rect(left + 2, doc.y + 10, 40, 3).fill(LIME_PURE);
    doc
      .fillColor(COVER_SUB)
      .font('Helvetica')
      .fontSize(13)
      .text(`${fmtLong(data.from)} — ${fmtLong(data.to)}`, left, doc.y + 22, { width });

    // Rodapé da capa — duas colunas limpas
    const fy = H - 92;
    doc
      .moveTo(left, fy)
      .lineTo(left + width, fy)
      .lineWidth(0.75)
      .strokeColor(COVER_LINE)
      .stroke();
    doc
      .fillColor(COVER_MUTE)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('PERÍODO', left, fy + 14, { characterSpacing: 1.5 });
    doc
      .fillColor(COVER_SUB)
      .font('Helvetica')
      .fontSize(10)
      .text(`${data.metrics.activeDays} dia(s) de atividade`, left, fy + 26);
    const c2 = left + width * 0.5;
    doc
      .fillColor(COVER_MUTE)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('VOLUME ANALISADO', c2, fy + 14, { characterSpacing: 1.5 });
    doc
      .fillColor(COVER_SUB)
      .font('Helvetica')
      .fontSize(10)
      .text(`${compact(data.metrics.totalMessages)} mensagens`, c2, fy + 26);
  }

  /** Quatro cartões de métrica (claros, com tick lime). */
  private _metrics(doc: PDFKit.PDFDocument, m: ReportMetrics, left: number, width: number): void {
    const cards: Array<[string, string]> = [
      ['Mensagens', compact(m.totalMessages)],
      ['Dias ativos', String(m.activeDays)],
      ['Pico de usuários', compact(m.peakUsers)],
      ['Pico / janela', m.peak ? compact(m.peak.messages) : '—'],
    ];
    const gap = 12;
    const cw = (width - gap * (cards.length - 1)) / cards.length;
    const ch = 82;
    ensureSpace(doc, ch + 16);
    const y = doc.y + 2;
    cards.forEach(([lbl, value], i) => {
      const x = left + i * (cw + gap);
      doc.roundedRect(x, y, cw, ch, 10).lineWidth(1).fillAndStroke(CARD, HAIR);
      doc.rect(x + 16, y + 16, 20, 3).fill(LIME);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(27)
        .text(value, x + 15, y + 28, { width: cw - 30, lineBreak: false });
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(lbl.toUpperCase(), x + 16, y + 62, { width: cw - 30, characterSpacing: 0.5 });
    });
    doc.y = y + ch + 18;
  }

  /** Faixa de destaque clara: pico do período + cobertura. */
  private _highlight(doc: PDFKit.PDFDocument, m: ReportMetrics, left: number, width: number): void {
    const h = 74;
    ensureSpace(doc, h + 16);
    const y = doc.y;
    doc.roundedRect(left, y, width, h, 10).lineWidth(1).fillAndStroke(HILITE_BG, HILITE_LINE);
    doc.roundedRect(left, y, 4, h, 2).fill(LIME);
    const avgPerDay = m.activeDays ? Math.round(m.totalMessages / m.activeDays) : m.totalMessages;
    const px = left + 22;
    doc
      .fillColor(OLIVE)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('DESTAQUE DO PERÍODO', px, y + 15, { characterSpacing: 1.6 });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(
        m.peak
          ? `Pico de ${compact(m.peak.messages)} mensagens em ${fmt(m.peak.at, true)}`
          : 'Sem pico de engajamento destacado no período',
        px,
        y + 29,
        { width: width - 44, lineBreak: false },
      );
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        `${m.windows} janelas analisadas   ·   ${compact(avgPerDay)} mensagens/dia ativo   ·   ${compact(m.peakUsers)} usuários no pico`,
        px,
        y + 51,
        { width: width - 44, lineBreak: false },
      );
    doc.y = y + h + 22;
  }

  /** Barra de sentimento empilhada + legenda. */
  private _sentiment(doc: PDFKit.PDFDocument, m: ReportMetrics, left: number, width: number): void {
    label(doc, 'Sentimento geral', left);
    const by = doc.y;
    const bh = 14;
    doc.save();
    doc.roundedRect(left, by, width, bh, bh / 2).clip();
    doc.rect(left, by, width, bh).fill(TRACK);
    const segs: Array<[number, string]> = [
      [m.sentiment.pos, POS],
      [m.sentiment.neu, NEU],
      [m.sentiment.neg, NEG],
    ];
    let cx = left;
    for (const [frac, color] of segs) {
      const w = Math.max(0, frac) * width;
      if (w > 0) doc.rect(cx, by, w, bh).fill(color);
      cx += w;
    }
    doc.restore();
    doc.y = by + bh + 12;
    const p = (x: number) => `${Math.round(x * 100)}%`;
    legendDot(doc, left, doc.y, POS, `Positivo ${p(m.sentiment.pos)}`);
    legendDot(doc, left + width / 3, doc.y, NEU, `Neutro ${p(m.sentiment.neu)}`);
    legendDot(doc, left + (2 * width) / 3, doc.y, NEG, `Negativo ${p(m.sentiment.neg)}`);
    doc.y += 22;
  }

  /** Nota de metodologia — honesta e discreta, sem expor modelo de IA. */
  private _methodology(
    doc: PDFKit.PDFDocument,
    data: ReportData,
    left: number,
    width: number,
  ): void {
    doc.moveDown(1);
    ensureSpace(doc, 70);
    const y = doc.y;
    doc
      .moveTo(left, y)
      .lineTo(left + width, y)
      .lineWidth(0.75)
      .strokeColor(HAIR)
      .stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text('METODOLOGIA', left, y + 12, { characterSpacing: 1.5 });
    const parts = [
      `Análise sobre ${compact(data.metrics.totalMessages)} mensagens do chat em ${data.metrics.windows} janelas, no período de ${fmtLong(data.from)} a ${fmtLong(data.to)}.`,
      data.generatedByAi
        ? 'Sentimento e pautas classificados automaticamente; texto-síntese assistido por IA e revisável.'
        : 'Sentimento, pautas e texto-síntese gerados automaticamente a partir das métricas do período.',
      data.sampleSize
        ? `Amostra editorial de ${data.sampleSize} mensagens usada para contexto qualitativo.`
        : '',
    ].filter(Boolean);
    doc
      .fillColor(FAINT)
      .font('Helvetica')
      .fontSize(8.5)
      .text(parts.join(' '), left, y + 24, { width, lineGap: 2 });
  }
}

// ── Formatação ────────────────────────────────────────────────────────────────
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmt(d: Date, withTime = false): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} · ${pad(d.getHours())}h${pad(d.getMinutes())}` : s;
}

function fmtLong(d: Date): string {
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

// ── Blocos de layout ──────────────────────────────────────────────────────────

/** Quebra de página se o bloco de altura `h` não couber acima do rodapé. */
function ensureSpace(doc: PDFKit.PDFDocument, h: number): void {
  if (doc.y + h > doc.page.height - FOOTER_RESERVE) doc.addPage();
}

/** Eyebrow de bloco: tick lime + rótulo curto oliva, espaçado. */
function eyebrow(doc: PDFKit.PDFDocument, text: string, left: number): void {
  doc.moveDown(0.8);
  ensureSpace(doc, 46);
  const y = doc.y;
  doc.rect(left, y + 1, 16, 2.5).fill(LIME);
  doc
    .fillColor(OLIVE)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(text.toUpperCase(), left + 24, y - 3, { characterSpacing: 2 });
  doc.moveDown(0.7);
}

/** Parágrafo-lead do resumo executivo (maior, com respiro). */
function lead(doc: PDFKit.PDFDocument, text: string, width: number): void {
  ensureSpace(doc, 60);
  doc.font('Helvetica').fontSize(12).fillColor(INK_SUB).text(text, {
    align: 'left',
    width,
    lineGap: 4,
  });
}

function section(doc: PDFKit.PDFDocument, title: string, left: number): void {
  doc.moveDown(0.8);
  ensureSpace(doc, 60);
  const y = doc.y;
  doc.roundedRect(left, y + 1, 3, 14, 1.5).fill(LIME);
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(title, left + 12, y);
  doc.moveDown(0.5);
}

function body(doc: PDFKit.PDFDocument, text: string, width: number): void {
  doc.font('Helvetica').fontSize(10.5).fillColor(INK_SUB).text(text, {
    align: 'left',
    width,
    lineGap: 3,
  });
}

function label(doc: PDFKit.PDFDocument, text: string, left: number): void {
  doc.moveDown(0.3);
  ensureSpace(doc, 40);
  doc
    .fillColor(MUTED)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(text.toUpperCase(), left, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.5);
}

function legendDot(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  color: string,
  text: string,
): void {
  doc.circle(x + 3, y + 5, 3).fill(color);
  doc
    .fillColor(INK_SUB)
    .font('Helvetica')
    .fontSize(9)
    .text(text, x + 11, y + 1);
}

/** Lista ranqueada: rótulo · barra proporcional · valor. */
function rankedBars(
  doc: PDFKit.PDFDocument,
  rows: Array<{ label: string; value: number }>,
  left: number,
  width: number,
  opts: { suffix?: string; color?: string; track?: string } = {},
): void {
  const color = opts.color ?? LIME;
  const trackColor = opts.track ?? TRACK;
  const suffix = opts.suffix ?? '';
  const labelW = 128;
  const valueW = 44;
  const barX = left + labelW + 10;
  const barW = width - labelW - valueW - 20;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 23;
  for (const r of rows) {
    ensureSpace(doc, rowH);
    const y = doc.y;
    const cy = y + 5;
    const bh = 10;
    doc
      .fillColor(INK_SUB)
      .font('Helvetica')
      .fontSize(9.5)
      .text(r.label, left, y + 1, { width: labelW, lineBreak: false, ellipsis: true });
    doc.roundedRect(barX, cy, barW, bh, bh / 2).fill(trackColor);
    const w = Math.max(4, (r.value / max) * barW);
    doc.roundedRect(barX, cy, w, bh, bh / 2).fill(color);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(`${r.value}${suffix}`, barX + barW + 6, y + 1, {
        width: valueW - 6,
        align: 'right',
        lineBreak: false,
      });
    doc.y = y + rowH;
  }
  doc.y += 4;
}

function chips(
  doc: PDFKit.PDFDocument,
  items: string[],
  left: number,
  width: number,
  right: number,
): void {
  const padX = 11;
  const h = 22;
  const gap = 6;
  let x = left;
  let y = doc.y;
  // Mede com a MESMA fonte usada na renderização, senão o texto estoura o chip.
  doc.font('Helvetica').fontSize(9);
  for (const item of items) {
    const w = doc.widthOfString(item) + padX * 2;
    if (x + w > right) {
      x = left;
      y += h + gap;
    }
    if (y + h > doc.page.height - FOOTER_RESERVE) {
      doc.addPage();
      x = left;
      y = doc.page.margins.top;
    }
    doc
      .roundedRect(x, y, w, h, h / 2)
      .lineWidth(1)
      .fillAndStroke(CARD, HAIR);
    doc
      .fillColor(INK_SUB)
      .font('Helvetica')
      .fontSize(9)
      .text(item, x + padX, y + 6.5, { width: w - padX * 2, lineBreak: false });
    x += w + gap;
  }
  doc.y = y + h + 14;
}
