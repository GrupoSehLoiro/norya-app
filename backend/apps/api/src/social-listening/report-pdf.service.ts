/**
 * ReportPdfService — renderiza o ReportData num PDF (pdfkit, sem browser).
 *
 * Estética alinhada ao sehloro-console: tema ESCURO (page #07090c) com acento
 * lime (#d7fe01), cartões em superfície escura com borda branca sutil (glass),
 * faixa de destaque, listas ranqueadas com barras, barra de sentimento e chips.
 * Texto em branco com opacidades aproximadas. Helvetica cobre acentos pt-BR.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ReportData, ReportMetrics } from './insights-report.service';

// Paleta do console (dark + lime)
const PAGE = '#07090c'; // --c-page / --c-bg-0
const SURFACE = '#11161c'; // --c-bg-2 (cartões)
const SURFACE_2 = '#0c1014'; // --c-bg-1
const TRACK = '#1a212a'; // trilho de barra
const CHIP_BG = '#141a21'; // superfície de chip
const HILITE_BG = '#10160c'; // superfície da faixa de destaque (dark + lime tint)
const LIME = '#d7fe01'; // --accent-400/500
const LIME_DIM = '#a8c800'; // --accent-600
const INK = '#ffffff'; // --c-ink-800
const INK_SUB = '#c6cace'; // ≈ ink-700
const MUTED = '#8b9096'; // ≈ ink-500/600
const FAINT = '#5c6166'; // ≈ ink-400
const LINE = '#1b2128'; // borda branca ~8% sobre dark
const POS = '#6ee7b7'; // positive
const NEG = '#f87171'; // negative
const NEU = '#4b5158'; // neutro discreto

const FOOTER_RESERVE = 64; // espaço reservado ao rodapé

@Injectable()
export class ReportPdfService {
  async render(data: ReportData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    // Fundo escuro em TODA página criada depois desta (conteúdo + overflow).
    doc.on('pageAdded', () => {
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(PAGE);
      doc.restore();
    });

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const right = left + width;
    const m = data.metrics;

    // ── Capa ──
    this._cover(doc, data);

    // ── Panorama ──
    doc.addPage();
    eyebrow(doc, 'Panorama', left);
    this._metrics(doc, m, left, width);
    this._highlight(doc, m, left, width);
    this._sentiment(doc, m, left, width);

    // ── Conversas (dados ranqueados) ──
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
        false,
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
        { suffix: '%', color: NEG, track: '#241317' },
      );
    }

    // ── Análise (IA) ──
    eyebrow(doc, 'Análise', left);
    section(doc, 'Resumo executivo', left);
    body(doc, data.narrative.resumoExecutivo, width);
    for (const s of data.narrative.secoes) {
      if (!s.titulo && !s.corpo) continue;
      section(doc, s.titulo, left);
      body(doc, s.corpo, width);
    }

    // ── Rodapé (todas exceto a capa) ──
    const range = doc.bufferedPageRange();
    const contentPages = range.count - 1;
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // rodapé não dispara auto-paginação
      const fy = doc.page.height - 40;
      doc.moveTo(left, fy).lineTo(right, fy).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.circle(left + 3, fy + 11, 2.2).fill(LIME);
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text('Norya · Análise de comunidade', left + 12, fy + 7, { lineBreak: false });
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(8)
        .text(`${i} / ${contentPages}`, left, fy + 7, { width, align: 'right', lineBreak: false });
    }

    doc.end();
    return done;
  }

  /** Capa escura com leve gradiente, halo lime e título grande. */
  private _cover(doc: PDFKit.PDFDocument, data: ReportData): void {
    const W = doc.page.width;
    const H = doc.page.height;
    const left = doc.page.margins.left;
    const width = W - doc.page.margins.left - doc.page.margins.right;

    const grad = doc.linearGradient(0, 0, W, H);
    grad.stop(0, SURFACE_2).stop(1, PAGE);
    doc.rect(0, 0, W, H).fill(grad);

    // Halo lime (eco do "led-halo" do console)
    doc.save();
    const halo = doc.radialGradient(W - 70, H - 120, 0, W - 70, H - 120, 260);
    halo.stop(0, LIME, 0.16).stop(1, LIME, 0);
    doc.rect(0, 0, W, H).fill(halo);
    doc.restore();

    // Anel sutil
    doc.save();
    doc.lineWidth(1).strokeOpacity(0.12).strokeColor(LIME);
    doc.circle(W - 70, H - 120, 150).stroke();
    doc.strokeOpacity(1);
    doc.restore();

    // Eyebrow / wordmark
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Norya', left, 64, { characterSpacing: 3 });
    doc
      .fillColor(LIME)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('RELATÓRIO DE COMUNIDADE DA LIVE', left, 82, { characterSpacing: 2 });
    doc.rect(left, 104, 34, 3).fill(LIME);

    // Título
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(40)
      .text(data.channelName, left, H * 0.42 - 30, { width, lineGap: 2 });
    doc
      .fillColor(INK_SUB)
      .font('Helvetica')
      .fontSize(13)
      .text(`Análise do chat  ·  ${fmt(data.from)} — ${fmt(data.to)}`, left, doc.y + 8, { width });

    // Rodapé da capa
    const fy = H - 84;
    doc
      .moveTo(left, fy)
      .lineTo(left + width, fy)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        `Gerado em ${fmt(new Date(), true)}   ·   ${data.generatedByAi ? 'Texto produzido por IA (Haiku)' : 'Análise automática'}   ·   ${data.sampleSize} mensagens amostradas`,
        left,
        fy + 12,
        { width },
      );
  }

  /** Quatro cartões de métrica com número-destaque. */
  private _metrics(doc: PDFKit.PDFDocument, m: ReportMetrics, left: number, width: number): void {
    const cards: Array<[string, string]> = [
      ['Mensagens', compact(m.totalMessages)],
      ['Dias ativos', String(m.activeDays)],
      ['Pico de usuários', compact(m.peakUsers)],
      ['Pico / janela', m.peak ? `${compact(m.peak.messages)}` : '—'],
    ];
    const gap = 12;
    const cw = (width - gap * (cards.length - 1)) / cards.length;
    const ch = 84;
    const y = doc.y + 4;
    cards.forEach(([lbl, value], i) => {
      const x = left + i * (cw + gap);
      doc.roundedRect(x, y, cw, ch, 12).fillAndStroke(SURFACE, LINE);
      doc.rect(x + 14, y + 16, 24, 3).fill(LIME);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(26)
        .text(value, x + 14, y + 28, { width: cw - 28, lineBreak: false });
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(lbl.toUpperCase(), x + 14, y + 64, { width: cw - 28, characterSpacing: 0.5 });
    });
    doc.y = y + ch + 16;
  }

  /** Faixa de destaque: pico do período + estatísticas de cobertura. */
  private _highlight(doc: PDFKit.PDFDocument, m: ReportMetrics, left: number, width: number): void {
    const h = 76;
    ensureSpace(doc, h + 14);
    const y = doc.y;
    doc.roundedRect(left, y, width, h, 12).fillAndStroke(HILITE_BG, LIME_DIM);
    doc.save();
    doc.fillOpacity(0.5);
    doc.roundedRect(left, y, 4, h, 2).fill(LIME);
    doc.restore();

    const avgPerDay = m.activeDays ? Math.round(m.totalMessages / m.activeDays) : m.totalMessages;
    const px = left + 20;
    doc
      .fillColor(LIME)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('DESTAQUE DO PERÍODO', px, y + 14, { characterSpacing: 1.5 });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(
        m.peak
          ? `Pico de ${compact(m.peak.messages)} mensagens em ${fmt(m.peak.at, true)}`
          : 'Sem pico de engajamento destacado no período',
        px,
        y + 28,
        { width: width - 40, lineBreak: false },
      );
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9.5)
      .text(
        `${m.windows} janelas analisadas   ·   média de ${compact(avgPerDay)} mensagens por dia ativo   ·   pico de ${compact(m.peakUsers)} usuários`,
        px,
        y + 52,
        { width: width - 40, lineBreak: false },
      );
    doc.y = y + h + 22;
  }

  /** Barra de sentimento empilhada + legenda. */
  private _sentiment(doc: PDFKit.PDFDocument, m: ReportMetrics, left: number, width: number): void {
    label(doc, 'Sentimento geral', left);
    const by = doc.y;
    const bh = 16;
    doc.save();
    doc.roundedRect(left, by, width, bh, bh / 2).clip();
    doc.rect(left, by, width, bh).fill(SURFACE);
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
    doc.y = by + bh + 10;
    const p = (x: number) => `${Math.round(x * 100)}%`;
    legendDot(doc, left, doc.y, POS, `Positivo ${p(m.sentiment.pos)}`);
    legendDot(doc, left + width / 3, doc.y, NEU, `Neutro ${p(m.sentiment.neu)}`);
    legendDot(doc, left + (2 * width) / 3, doc.y, NEG, `Negativo ${p(m.sentiment.neg)}`);
    doc.y += 22;
  }
}

function fmt(d: Date, withTime = false): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Quebra de página se o bloco de altura `h` não couber acima do rodapé. */
function ensureSpace(doc: PDFKit.PDFDocument, h: number): void {
  if (doc.y + h > doc.page.height - FOOTER_RESERVE) doc.addPage();
}

/** Eyebrow de bloco: rótulo curto lime, espaçado. */
function eyebrow(doc: PDFKit.PDFDocument, text: string, left: number): void {
  doc.moveDown(0.7);
  ensureSpace(doc, 40);
  doc
    .fillColor(LIME)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(text.toUpperCase(), left, doc.y, { characterSpacing: 2 });
  doc.moveDown(0.5);
}

function section(doc: PDFKit.PDFDocument, title: string, left: number): void {
  doc.moveDown(0.7);
  ensureSpace(doc, 60);
  const y = doc.y;
  doc.roundedRect(left, y + 2, 4, 15, 2).fill(LIME);
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(title, left + 13, y);
  doc.moveDown(0.45);
}

function body(doc: PDFKit.PDFDocument, text: string, width: number): void {
  doc.font('Helvetica').fontSize(10.5).fillColor(INK_SUB).text(text, {
    align: 'justify',
    width,
    lineGap: 2.5,
  });
}

function label(doc: PDFKit.PDFDocument, text: string, left: number): void {
  doc.moveDown(0.2);
  ensureSpace(doc, 40);
  doc
    .fillColor(FAINT)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text(text.toUpperCase(), left, doc.y, { characterSpacing: 0.8 });
  doc.moveDown(0.4);
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
    .fontSize(8.5)
    .text(text, x + 10, y + 1.5);
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
  const labelW = 120;
  const valueW = 42;
  const barX = left + labelW + 10;
  const barW = width - labelW - valueW - 20;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 22;
  for (const r of rows) {
    ensureSpace(doc, rowH);
    const y = doc.y;
    const cy = y + 6;
    const bh = 9;
    doc
      .fillColor(INK_SUB)
      .font('Helvetica')
      .fontSize(9.5)
      .text(r.label, left, y + 2, { width: labelW, lineBreak: false, ellipsis: true });
    doc.roundedRect(barX, cy, barW, bh, bh / 2).fill(trackColor);
    const w = Math.max(3, (r.value / max) * barW);
    doc.roundedRect(barX, cy, w, bh, bh / 2).fill(color);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(`${r.value}${suffix}`, barX + barW + 6, y + 2, {
        width: valueW - 6,
        align: 'right',
        lineBreak: false,
      });
    doc.y = y + rowH;
  }
  doc.y += 6;
}

function chips(
  doc: PDFKit.PDFDocument,
  items: string[],
  left: number,
  width: number,
  right: number,
  accent: boolean,
): void {
  const padX = 10;
  const h = 21;
  const gap = 6;
  let x = left;
  let y = doc.y;
  // Mede com a MESMA fonte usada na renderização (bold), senão o texto estoura o chip.
  doc.font('Helvetica-Bold').fontSize(9);
  const txt = accent ? LIME : INK_SUB;
  const border = accent ? LIME_DIM : LINE;
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
    doc.save();
    if (accent) doc.strokeOpacity(0.4);
    doc
      .lineWidth(1)
      .roundedRect(x, y, w, h, h / 2)
      .fillAndStroke(CHIP_BG, border);
    doc.restore();
    doc
      .fillColor(txt)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(item, x + padX, y + 6, { width: w - padX * 2, lineBreak: false });
    x += w + gap;
  }
  doc.y = y + h + 14;
}
