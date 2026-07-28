'use client';

/**
 * Area chart de atividade do chat ao longo da janela monitorada — com
 * interação de TIMELINE (estilo editor de vídeo):
 *
 *   - Duas AGULHAS delimitam a seleção; default = dia inteiro (sem recorte).
 *   - Arrastar uma agulha refina o início/fim; arrastar o miolo move o
 *     recorte inteiro; arrastar numa área vazia desenha um recorte novo.
 *   - Clique simples cria um recorte de ±10min no ponto; duplo-clique limpa.
 *   - Scroll/trackpad dá zoom ancorado no cursor (deltaX faz pan).
 *   - O painel abaixo (mensagens + resumo IA) segue a seleção; os números
 *     (msgs/usuários/janelas) atualizam AO VIVO durante o arrasto — as
 *     consultas pesadas só disparam quando o arrasto termina.
 *
 * Eixo X = windowStart (tempo). Y1 = messageCount, Y2 = uniqueUsers.
 * O dia selecionado e o modo "ao vivo" são controlados pela página.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AreaClosed, LinePath } from '@visx/shape';
import { Group } from '@visx/group';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { scaleLinear, scaleTime } from '@visx/scale';
import { ParentSize } from '@visx/responsive';
import { curveMonotoneX } from '@visx/curve';
import { extent, max } from 'd3-array';
import { timeFormat } from 'd3-time-format';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InsightText } from '@/components/ui/insight-text';
import { ChatLine, ChatSkinStyles, type ChatPlatform } from '@/components/ui/chat-skin';
import { useChannelEmotes } from '@/hooks/use-channel-emotes';
import { api, getToken } from '@/lib/api-client';
import { searchMessages, fetchWindowInsight } from '@/lib/analytics';
import { fetchChannels } from '@/lib/queries';
import {
  dayBoundsIso,
  formatYmdLabel,
  parseUtcDate,
  parseYmd,
  shiftYmd,
  todayYmd,
} from '@/lib/day-range';
import type { BatchAnalysis, InsightsHistoryResponse } from '@/lib/types';

interface Point {
  ts: Date;
  msgs: number;
  users: number;
  /** Fração positiva do sentimento da janela (0..1). */
  pos: number;
}

/** Recorte entre as agulhas, em ms de epoch (estável p/ deps de query). */
interface Sel {
  a: number;
  b: number;
}

const COLOR_MSGS = '#d7fe01';   // lime accent
const COLOR_USERS = '#a78bfa';  // twitch purple, contrast pair
const COLOR_GRID = 'rgba(255,255,255,0.06)';
const COLOR_AXIS = 'rgba(255,255,255,0.18)';
const COLOR_TEXT = 'rgba(255,255,255,0.60)';
const COLOR_WATERMARK = 'rgba(255,255,255,0.16)';
const COLOR_DIM = 'rgba(0,0,0,0.45)';

const MIN_SEL_MS = 30_000;      // recorte mínimo: 30s
const MIN_ZOOM_MS = 2 * 60_000; // zoom máximo: janela de 2min
const CLICK_SEL_MS = 10 * 60_000; // clique simples: ±10min

const formatHour = timeFormat('%H:%M');
const formatDate = timeFormat('%d/%m %H:%M');

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return `${Math.round(ms / 1000)}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}min`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function selStats(points: Point[], sel: Sel) {
  let msgs = 0;
  let peakUsers = 0;
  let windows = 0;
  let posWeighted = 0;
  for (const p of points) {
    const t = p.ts.getTime();
    if (t >= sel.a && t <= sel.b) {
      msgs += p.msgs;
      posWeighted += p.pos * p.msgs;
      if (p.users > peakUsers) peakUsers = p.users;
      windows += 1;
    }
  }
  // Sentimento do recorte, ponderado por volume.
  const posPct = msgs > 0 ? Math.round((posWeighted / msgs) * 100) : null;
  return { msgs, peakUsers, windows, posPct };
}

interface Props {
  channelId: string | null;
  /** Dia em FOCO no gráfico grande (YYYY-MM-DD) — controlado pela página. */
  date: string;
  /** Seleção única de um dia (chevrons/Hoje/Ontem): colapsa o período. */
  onDateChange: (ymd: string) => void;
  /** Todos os dias do período (multi-seleção via calendário). */
  dates?: string[];
  /** Toggle de um dia no calendário; `touched` é o dia clicado. */
  onDatesChange?: (dates: string[], touched: string) => void;
  /** Troca só o dia em foco (clique numa miniatura), sem mexer na seleção. */
  onFocusChange?: (ymd: string) => void;
  /** Modo ao vivo: segue o dia de hoje com refresh automático. */
  live: boolean;
  onLiveChange: (live: boolean) => void;
  limit?: number;
}

export function ActivityAreaChart({
  channelId, date, onDateChange, dates, onDatesChange, onFocusChange, live, onLiveChange, limit = 500,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  // Idioma do relatório: rótulos do PDF e narrativa da IA.
  const [reportLang, setReportLang] = useState<'pt' | 'en'>('pt');
  const [expanded, setExpanded] = useState(false);
  // Seleção confirmada (dispara consultas) vs. preview durante o arrasto.
  const [sel, setSel] = useState<Sel | null>(null);
  const [dragSel, setDragSel] = useState<Sel | null>(null);
  // Domínio X do zoom (null = extensão total dos dados do dia).
  const [xDomain, setXDomain] = useState<[number, number] | null>(null);
  const { from, to } = useMemo(() => dayBoundsIso(date), [date]);
  const isToday = date === todayYmd();

  // Relatório PDF: o backend agrega os batches do período visível, gera o
  // texto pela IA (mesma dos batches) e devolve o PDF pra baixar.
  async function handlePdf() {
    if (!channelId || pdfLoading) return;
    setPdfLoading(true);
    try {
      const token = getToken();
      const url =
        `/api/v2/social-listening/insights/report.pdf?channelId=${encodeURIComponent(channelId)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
        `&lang=${reportLang}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        alert(`Falha ao gerar relatório: HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `relatorio-${channelId}-${date}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      alert(`Falha ao gerar relatório: ${(err as Error).message}`);
    } finally {
      setPdfLoading(false);
    }
  }

  const history = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-history', channelId, 'chart', date, limit],
    queryFn: () => api.get<InsightsHistoryResponse>(
      `/api/v2/social-listening/insights/history?channelId=${encodeURIComponent(channelId!)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${limit}`,
    ),
    // Refresh automático só no modo ao vivo (dias passados são imutáveis).
    refetchInterval: live && isToday ? 15_000 : false,
  });

  const points: Point[] = useMemo(() => {
    if (!history.data?.items) return [];
    return [...history.data.items]
      .reverse()
      .map((b: BatchAnalysis) => ({
        ts: parseUtcDate(b.windowStart),
        msgs: b.messageCount,
        users: b.uniqueUsers,
        pos: b.climaGeral?.pos ?? 0,
      }));
  }, [history.data]);

  // Trocou de dia ou de canal → limpa recorte e zoom.
  useEffect(() => {
    setSel(null);
    setDragSel(null);
    setXDomain(null);
  }, [date, channelId]);

  // Horário + tempo de live do período visível (primeiro → último batch).
  const spanLabel = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0]!.ts;
    const last = points[points.length - 1]!.ts;
    return `${formatHour(first)} – ${formatHour(last)} · ${fmtDuration(last.getTime() - first.getTime())} de live`;
  }, [points]);

  const today = todayYmd();
  const yesterday = shiftYmd(today, -1);
  const selectedDates = dates && dates.length > 0 ? dates : [date];
  const multiDay = selectedDates.length > 1;
  const isYesterday = date === yesterday && !multiDay;
  const canGoForward = date < today;

  function changeDate(ymd: string) {
    onDateChange(ymd);
    if (ymd !== today && live) onLiveChange(false);
  }

  function toggleDate(ymd: string) {
    if (!onDatesChange) {
      // Sem suporte a multi-dia (página do canal): comporta como antes.
      changeDate(ymd);
      setPickerOpen(false);
      return;
    }
    const next = selectedDates.includes(ymd)
      ? selectedDates.filter((d) => d !== ymd)
      : [...selectedDates, ymd].sort();
    if (next.length === 0) return; // nunca vazio
    onDatesChange(next, ymd);
    if (ymd !== today && live) onLiveChange(false);
  }

  function toggleLive() {
    if (live) {
      onLiveChange(false);
    } else {
      onLiveChange(true);
      onDateChange(today);
    }
  }

  const visualSel = dragSel ?? sel;
  const liveStats = visualSel ? selStats(points, visualSel) : null;

  function zoomToSelection() {
    if (!sel) return;
    const pad = Math.max((sel.b - sel.a) * 0.08, 30_000);
    setXDomain([sel.a - pad, sel.b + pad]);
  }

  const chartEl = (h: string) =>
    !channelId ? (
      <p className="text-sm text-ink-400">Selecione um canal pra ver o gráfico.</p>
    ) : history.isLoading ? (
      <p className="text-sm text-ink-400">carregando…</p>
    ) : points.length === 0 ? (
      <p className="text-sm text-ink-400">
        {isToday
          ? 'Sem atividade hoje. Abra uma live e o gráfico se preenche.'
          : 'Sem atividade nesta data.'}
      </p>
    ) : (
      <div className={`${h} w-full`}>
        <ParentSize>
          {({ width, height }) => (
            <TimelineChart
              width={width}
              height={height}
              points={points}
              visualSel={visualSel}
              xDomain={xDomain}
              onPreview={setDragSel}
              onCommit={(s) => { setDragSel(null); setSel(s); }}
              onZoom={setXDomain}
            />
          )}
        </ParentSize>
      </div>
    );

  return (
    // Com o popover do calendário aberto, o card precisa vencer os cards
    // seguintes: o hover deles aplica transform (novo stacking context) e
    // pintaria por cima do popover. z só enquanto aberto — permanente
    // rebaixaria o overlay expandido (fixed) pra dentro deste contexto.
    <Card className={pickerOpen ? 'z-20' : undefined}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {channelId ? (
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button
                variant="primary"
                size="md"
                loading={pdfLoading}
                onClick={handlePdf}
                title="Gera um relatório da live (IA) e baixa em PDF"
              >
                {!pdfLoading && <DownloadIcon />}
                Relatório PDF
              </Button>
              <select
                value={reportLang}
                onChange={(e) => setReportLang(e.target.value as 'pt' | 'en')}
                title="Idioma do relatório (textos e narrativa da IA)"
                aria-label="Idioma do relatório"
                className="h-9 appearance-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-medium text-ink-700 focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20"
              >
                <option value="pt" className="bg-bg-1 text-ink-800">Português</option>
                <option value="en" className="bg-bg-1 text-ink-800">English</option>
              </select>
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="eyebrow mb-2">{live && isToday ? 'Atividade ao vivo' : 'Histórico'}</p>
            <h2 className="text-base font-semibold tracking-tight text-ink-800">
              Atividade do chat ao longo da live
            </h2>
            <p className="mt-1 text-sm text-ink-400">
              {spanLabel ?? 'Mensagens e usuários únicos ao longo do tempo.'}
            </p>
            {points.length > 0 && (
              <p className="mt-0.5 text-xs text-ink-400">
                Clique ou arraste no gráfico pra recortar um momento; arraste as
                agulhas pra refinar · scroll dá zoom · duplo-clique limpa.
              </p>
            )}
          </div>
        </div>
        {channelId ? (
          <div className="flex flex-wrap items-center gap-2">
              <DateChip active={live && isToday} onClick={toggleLive}>
                <span className="flex items-center gap-1.5">
                  <span
                    className={
                      'inline-block h-1.5 w-1.5 rounded-full ' +
                      (live && isToday ? 'bg-accent-400 shadow-[0_0_8px_rgba(215,254,1,0.7)]' : 'bg-ink-400')
                    }
                    aria-hidden
                  />
                  Ao vivo
                </span>
              </DateChip>
              <DateChip active={isToday && !live} onClick={() => changeDate(today)}>
                Hoje
              </DateChip>
              <DateChip active={isYesterday} onClick={() => changeDate(yesterday)}>
                Ontem
              </DateChip>

              <div className="relative">
                <div className="flex items-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04]">
                  <IconBtn
                    aria-label="Dia anterior"
                    onClick={() => changeDate(shiftYmd(date, -1))}
                  >
                    <ChevronLeft />
                  </IconBtn>

                  <button
                    type="button"
                    onClick={() => setPickerOpen((v) => !v)}
                    aria-haspopup="dialog"
                    aria-expanded={pickerOpen}
                    aria-label="Abrir calendário"
                    className={
                      'flex h-8 items-center gap-2 px-3 text-xs text-ink-700 transition-colors ' +
                      'hover:bg-white/[0.06] hover:text-ink-800 ' +
                      'focus:outline-none focus-visible:bg-white/[0.06] focus-visible:text-ink-800'
                    }
                  >
                    <CalendarIcon />
                    <span className="tabular-nums">
                      {formatYmdLabel(date)}
                      {multiDay ? (
                        <span className="ml-1.5 rounded-full bg-accent-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300">
                          +{selectedDates.length - 1}
                        </span>
                      ) : null}
                    </span>
                  </button>

                  <IconBtn
                    aria-label="Próximo dia"
                    onClick={() => changeDate(shiftYmd(date, 1))}
                    disabled={!canGoForward}
                  >
                    <ChevronRight />
                  </IconBtn>
                </div>

                {pickerOpen && (
                  <CalendarPopover
                    value={date}
                    selected={selectedDates}
                    maxYmd={today}
                    onToggle={toggleDate}
                    onReset={(ymd) => {
                      changeDate(ymd);
                      setPickerOpen(false);
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>

              {sel && (
                <DateChip onClick={zoomToSelection}>
                  <span className="flex items-center gap-1"><ZoomIcon /> Zoom na seleção</span>
                </DateChip>
              )}
              {(xDomain || sel) && (
                <DateChip onClick={() => { setXDomain(null); setSel(null); setDragSel(null); }}>
                  Dia inteiro
                </DateChip>
              )}

              <IconBtn aria-label="Expandir gráfico" onClick={() => setExpanded(true)}>
                <ExpandIcon />
              </IconBtn>

              <Badge tone="accent">{points.length} janelas</Badge>
          </div>
        ) : null}
      </div>

      {/* Faixa de miniaturas — um sparkline por dia da seleção; clique foca
          o dia no gráfico grande sem mexer na seleção. */}
      {channelId && multiDay && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {selectedDates.map((d) => (
            <DayThumb
              key={d}
              channelId={channelId}
              ymd={d}
              active={d === date}
              limit={limit}
              onClick={() => (onFocusChange ?? onDateChange)(d)}
            />
          ))}
        </div>
      )}

      {!expanded && chartEl('h-72')}

      {!expanded && channelId && visualSel && liveStats && (
        <RangeDrilldown
          channelId={channelId}
          committed={sel}
          visual={visualSel}
          stats={liveStats}
          dragging={dragSel !== null}
          onClose={() => { setSel(null); setDragSel(null); }}
        />
      )}

      {/* Modo expandido — portal pro body: o hover do card aplica transform,
          que viraria containing block do fixed e prenderia o overlay no card. */}
      {expanded && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-0/85 p-6"
          style={{ backdropFilter: 'blur(14px)' }}
          role="dialog"
          aria-label="Gráfico expandido"
        >
          <div className="glass-card flex h-[85vh] w-[92vw] max-w-[1400px] flex-col overflow-y-auto p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink-800">
                  Atividade do chat ao longo da live
                </h2>
                <p className="mt-0.5 text-sm text-ink-400">
                  {formatYmdLabel(date)}{spanLabel ? ` · ${spanLabel}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {sel && (
                  <DateChip onClick={zoomToSelection}>
                    <span className="flex items-center gap-1"><ZoomIcon /> Zoom na seleção</span>
                  </DateChip>
                )}
                {(xDomain || sel) && (
                  <DateChip onClick={() => { setXDomain(null); setSel(null); setDragSel(null); }}>
                    Dia inteiro
                  </DateChip>
                )}
                <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                  Fechar ✕
                </Button>
              </div>
            </div>
            <div className="min-h-[46vh] flex-1">
              {chartEl('h-full')}
            </div>
            {channelId && visualSel && liveStats && (
              <RangeDrilldown
                channelId={channelId}
                committed={sel}
                visual={visualSel}
                stats={liveStats}
                dragging={dragSel !== null}
                onClose={() => { setSel(null); setDragSel(null); }}
              />
            )}
          </div>
        </div>,
        document.body,
      )}
    </Card>
  );
}

// ─── Drill-down do recorte: mensagens + resumo via IA ──────────────────────

function RangeDrilldown({
  channelId, committed, visual, stats, dragging, onClose,
}: {
  channelId: string;
  /** Recorte confirmado (solto) — é o que dispara as consultas. */
  committed: Sel | null;
  /** Recorte visual (inclui preview do arrasto) — números ao vivo. */
  visual: Sel;
  stats: {
    msgs: number;
    peakUsers: number;
    windows: number;
    posPct: number | null;
  };
  dragging: boolean;
  onClose: () => void;
}) {
  const winFrom = committed ? new Date(committed.a).toISOString() : null;
  const winTo = committed ? new Date(committed.b).toISOString() : null;
  const emotes = useChannelEmotes(channelId);

  // Plataforma do canal → skin das mensagens (mesma estética do Feed ao vivo).
  const channelsQ = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
    staleTime: 60_000,
  });
  const platform: ChatPlatform =
    channelsQ.data?.find((c) => c.id === channelId)?.platform === 'kick' ? 'kick' : 'twitch';

  const msgs = useQuery({
    enabled: !!committed && !dragging,
    queryKey: ['range-messages', channelId, winFrom, winTo],
    queryFn: () => searchMessages(channelId, '', winFrom!, winTo!),
    staleTime: 60_000,
  });
  const insight = useQuery({
    enabled: !!committed && !dragging,
    queryKey: ['range-insight', channelId, winFrom, winTo],
    queryFn: () => fetchWindowInsight(channelId, { from: winFrom!, to: winTo! }),
    staleTime: 60_000,
  });

  const stale = dragging || !committed;

  return (
    <div className="mt-5 rounded-xl border border-accent-400/20 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums text-ink-800">
          Pico das {formatHour(new Date(visual.a))} às {formatHour(new Date(visual.b))}
        </p>
        <div className="flex items-center gap-3">
          {dragging && <span className="text-[11px] text-accent-300">solte pra analisar…</span>}
          <button type="button" onClick={onClose} className="text-xs text-ink-400 hover:text-ink-700">
            limpar recorte ✕
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs tabular-nums text-ink-400">
        {fmtDuration(visual.b - visual.a)} · {stats.msgs.toLocaleString('pt-BR')} mensagens ·
        pico de {stats.peakUsers} {stats.peakUsers === 1 ? 'usuário' : 'usuários'} · {stats.windows}{' '}
        {stats.windows === 1 ? 'janela' : 'janelas'}
        {stats.posPct !== null ? ` · ${stats.posPct}% positivo` : ''}
      </p>

      <div className={'mt-3 grid grid-cols-1 gap-4 transition-opacity lg:grid-cols-2 ' + (stale ? 'opacity-45' : '')}>
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
            Resumo do momento (IA)
          </p>
          {!committed || insight.isLoading ? (
            <p className="text-sm text-ink-400">gerando resumo…</p>
          ) : insight.isError ? (
            <p className="text-sm text-err">Não foi possível gerar o resumo agora.</p>
          ) : (
            <InsightText text={insight.data?.insight ?? ''} />
          )}
        </div>
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-400">
            Mensagens desse momento
          </p>
          {!committed || msgs.isLoading ? (
            <p className="text-sm text-ink-400">carregando…</p>
          ) : (msgs.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-400">Sem mensagens registradas nesse recorte.</p>
          ) : (
            <ul className={`chat-skin skin-${platform} max-h-48 overflow-y-auto rounded-lg px-1.5 py-1.5`}>
              {msgs.data!.items.slice(0, 60).map((m) => (
                <ChatLine key={m.messageId} m={m} platform={platform} emotes={emotes} />
              ))}
            </ul>
          )}
          <ChatSkinStyles />
        </div>
      </div>
    </div>
  );
}

// ─── TimelineChart (svg + agulhas + zoom) ──────────────────────────────────

type DragMode = 'a' | 'b' | 'move' | 'new';

interface TimelineChartProps {
  width: number;
  height: number;
  points: Point[];
  visualSel: Sel | null;
  xDomain: [number, number] | null;
  onPreview: (s: Sel | null) => void;
  onCommit: (s: Sel | null) => void;
  onZoom: (d: [number, number] | null) => void;
}

function TimelineChart({
  width, height, points, visualSel, xDomain, onPreview, onCommit, onZoom,
}: TimelineChartProps) {
  const margin = { top: 26, right: 16, bottom: 28, left: 36 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);

  const svgRef = useRef<SVGSVGElement>(null);
  // IDs de defs únicos por instância — o chart do card e o expandido montam
  // juntos, e url(#…) resolve pro primeiro id do documento.
  const uid = useId().replace(/:/g, '');
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startSel: Sel | null;
    moved: boolean;
  } | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const dataExtent = useMemo(() => {
    const [d0, d1] = extent(points, (p) => p.ts) as [Date, Date];
    return [d0.getTime(), d1.getTime()] as [number, number];
  }, [points]);

  const domain = xDomain ?? dataExtent;

  const yMax = Math.max(
    max(points, (p) => p.msgs) ?? 0,
    max(points, (p) => p.users) ?? 0,
    5,
  );
  const xScale = useMemo(
    () => scaleTime({ domain: [new Date(domain[0]), new Date(domain[1])], range: [0, innerWidth] }),
    [domain, innerWidth],
  );
  const yScale = useMemo(
    () => scaleLinear({ domain: [0, yMax * 1.15], range: [innerHeight, 0], nice: true }),
    [yMax, innerHeight],
  );

  // Mantém 1 ponto além de cada borda do zoom — a curva atravessa o plot e o
  // clipPath corta na moldura; filtrar só o miolo faz a onda "sumir" ao zoomar.
  const visible = useMemo(() => {
    if (points.length === 0) return points;
    let start = points.findIndex((p) => p.ts.getTime() >= domain[0]);
    if (start === -1) start = points.length;
    let end = points.length - 1;
    while (end >= 0 && points[end]!.ts.getTime() > domain[1]) end -= 1;
    return points.slice(Math.max(0, start - 1), Math.min(points.length, end + 2));
  }, [points, domain]);

  // Zoom por wheel precisa de listener non-passive (preventDefault).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const px = e.clientX - rect.left - margin.left;
      const frac = Math.min(1, Math.max(0, px / Math.max(1, innerWidth)));
      const [d0, d1] = domain;
      const span = d1 - d0;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // pan horizontal (trackpad)
        const shift = (e.deltaX / Math.max(1, innerWidth)) * span;
        let n0 = d0 + shift;
        let n1 = d1 + shift;
        if (n0 < dataExtent[0]) { n1 += dataExtent[0] - n0; n0 = dataExtent[0]; }
        if (n1 > dataExtent[1]) { n0 -= n1 - dataExtent[1]; n1 = dataExtent[1]; }
        onZoom([n0, n1]);
        return;
      }
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      let newSpan = span * factor;
      const fullSpan = dataExtent[1] - dataExtent[0];
      if (newSpan >= fullSpan) { onZoom(null); return; }
      newSpan = Math.max(MIN_ZOOM_MS, newSpan);
      const anchor = d0 + frac * span;
      let n0 = anchor - frac * newSpan;
      let n1 = n0 + newSpan;
      if (n0 < dataExtent[0]) { n0 = dataExtent[0]; n1 = n0 + newSpan; }
      if (n1 > dataExtent[1]) { n1 = dataExtent[1]; n0 = n1 - newSpan; }
      onZoom([n0, n1]);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [domain, dataExtent, innerWidth, margin.left, onZoom]);

  if (innerWidth <= 0 || innerHeight <= 0) return null;

  const toTime = (px: number) =>
    domain[0] + (Math.min(innerWidth, Math.max(0, px)) / innerWidth) * (domain[1] - domain[0]);
  const toPx = (t: number) => ((t - domain[0]) / (domain[1] - domain[0])) * innerWidth;

  const clampT = (t: number) => Math.min(dataExtent[1], Math.max(dataExtent[0], t));

  function localX(e: React.PointerEvent): number {
    const rect = svgRef.current!.getBoundingClientRect();
    return e.clientX - rect.left - margin.left;
  }

  function hitTest(px: number): DragMode {
    if (visualSel) {
      const ax = toPx(visualSel.a);
      const bx = toPx(visualSel.b);
      if (Math.abs(px - ax) <= 9) return 'a';
      if (Math.abs(px - bx) <= 9) return 'b';
      if (px > ax && px < bx) return 'move';
    }
    return 'new';
  }

  function onPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0) return;
    const px = localX(e);
    dragRef.current = { mode: hitTest(px), startX: px, startSel: visualSel, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGRectElement>) {
    const px = localX(e);
    const d = dragRef.current;
    if (!d) {
      setHoverX(px >= 0 && px <= innerWidth ? px : null);
      return;
    }
    if (Math.abs(px - d.startX) > 3) d.moved = true;
    if (!d.moved) return;
    const t = clampT(toTime(px));
    if (d.mode === 'new') {
      const t0 = clampT(toTime(d.startX));
      const a = Math.min(t0, t);
      const b = Math.max(t0, t);
      onPreview({ a, b: Math.max(b, a + MIN_SEL_MS) });
    } else if (d.mode === 'a' && d.startSel) {
      onPreview({ a: Math.min(t, d.startSel.b - MIN_SEL_MS), b: d.startSel.b });
    } else if (d.mode === 'b' && d.startSel) {
      onPreview({ a: d.startSel.a, b: Math.max(t, d.startSel.a + MIN_SEL_MS) });
    } else if (d.mode === 'move' && d.startSel) {
      const span = d.startSel.b - d.startSel.a;
      let a = d.startSel.a + (toTime(px) - toTime(d.startX));
      a = Math.min(Math.max(a, dataExtent[0]), dataExtent[1] - span);
      onPreview({ a, b: a + span });
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGRectElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const px = localX(e);
    if (!d.moved) {
      if (d.mode === 'move' || d.mode === 'a' || d.mode === 'b') {
        // clique dentro do recorte sem arrastar — mantém como está
        onCommit(d.startSel);
        return;
      }
      // clique simples: recorte de ±10min centrado no ponto
      const t = clampT(toTime(px));
      const a = clampT(t - CLICK_SEL_MS);
      const b = clampT(t + CLICK_SEL_MS);
      onCommit({ a, b: Math.max(b, a + MIN_SEL_MS) });
      return;
    }
    // solta o arrasto → confirma o preview atual
    const t = clampT(toTime(px));
    if (d.mode === 'new') {
      const t0 = clampT(toTime(d.startX));
      const a = Math.min(t0, t);
      const b = Math.max(t0, t);
      onCommit({ a, b: Math.max(b, a + MIN_SEL_MS) });
    } else if (d.mode === 'a' && d.startSel) {
      onCommit({ a: Math.min(t, d.startSel.b - MIN_SEL_MS), b: d.startSel.b });
    } else if (d.mode === 'b' && d.startSel) {
      onCommit({ a: d.startSel.a, b: Math.max(t, d.startSel.a + MIN_SEL_MS) });
    } else if (d.mode === 'move' && d.startSel) {
      const span = d.startSel.b - d.startSel.a;
      let a = d.startSel.a + (toTime(px) - toTime(d.startX));
      a = Math.min(Math.max(a, dataExtent[0]), dataExtent[1] - span);
      onCommit({ a, b: a + span });
    }
  }

  const spanMinutes = (domain[1] - domain[0]) / 60_000;
  const tickFormatter = spanMinutes > 90 ? formatDate : formatHour;

  // ponto mais próximo do hover (crosshair)
  const hoverPoint = hoverX != null && visible.length > 0
    ? visible.reduce((best, p) =>
        Math.abs(toPx(p.ts.getTime()) - hoverX) < Math.abs(toPx(best.ts.getTime()) - hoverX) ? p : best)
    : null;

  const cursorFor = (px: number | null): string => {
    if (px == null) return 'crosshair';
    const mode = hitTest(px);
    return mode === 'a' || mode === 'b' ? 'col-resize' : mode === 'move' ? 'grab' : 'crosshair';
  };

  return (
    <svg ref={svgRef} width={width} height={height} aria-label="atividade do chat" style={{ userSelect: 'none' }}>
      <defs>
        <linearGradient id={`grad-msgs-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={COLOR_MSGS} stopOpacity={0.40} />
          <stop offset="100%" stopColor={COLOR_MSGS} stopOpacity={0.02} />
        </linearGradient>
        <linearGradient id={`grad-users-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={COLOR_USERS} stopOpacity={0.30} />
          <stop offset="100%" stopColor={COLOR_USERS} stopOpacity={0.02} />
        </linearGradient>
        <clipPath id={`plot-clip-${uid}`}>
          <rect x={0} y={-margin.top} width={innerWidth} height={innerHeight + margin.top} />
        </clipPath>
      </defs>

      <Group left={margin.left} top={margin.top}>
        {yScale.ticks(4).map((t) => (
          <line
            key={String(t)}
            x1={0} x2={innerWidth} y1={yScale(t)} y2={yScale(t)}
            stroke={COLOR_GRID} strokeDasharray="2,3"
          />
        ))}

        <g clipPath={`url(#plot-clip-${uid})`}>
          <AreaClosed<Point>
            data={visible}
            x={(d) => xScale(d.ts) ?? 0}
            y={(d) => yScale(d.msgs) ?? 0}
            yScale={yScale}
            fill={`url(#grad-msgs-${uid})`}
            curve={curveMonotoneX}
          />
          <LinePath<Point>
            data={visible}
            x={(d) => xScale(d.ts) ?? 0}
            y={(d) => yScale(d.msgs) ?? 0}
            stroke={COLOR_MSGS} strokeWidth={2} curve={curveMonotoneX}
          />

          <AreaClosed<Point>
            data={visible}
            x={(d) => xScale(d.ts) ?? 0}
            y={(d) => yScale(d.users) ?? 0}
            yScale={yScale}
            fill={`url(#grad-users-${uid})`}
            curve={curveMonotoneX}
          />
          <LinePath<Point>
            data={visible}
            x={(d) => xScale(d.ts) ?? 0}
            y={(d) => yScale(d.users) ?? 0}
            stroke={COLOR_USERS} strokeWidth={1.5} strokeDasharray="4,3" curve={curveMonotoneX}
          />

          {/* Recorte entre as agulhas: fora fica esmaecido, dentro realçado */}
          {visualSel && (
            <g>
              <rect x={0} y={0} width={Math.max(0, toPx(visualSel.a))} height={innerHeight} fill={COLOR_DIM} />
              <rect
                x={Math.min(innerWidth, toPx(visualSel.b))}
                y={0}
                width={Math.max(0, innerWidth - toPx(visualSel.b))}
                height={innerHeight}
                fill={COLOR_DIM}
              />
              <rect
                x={toPx(visualSel.a)}
                y={0}
                width={Math.max(0, toPx(visualSel.b) - toPx(visualSel.a))}
                height={innerHeight}
                fill={COLOR_MSGS}
                opacity={0.05}
              />
            </g>
          )}
        </g>

        {/* Crosshair de hover (fora de arrasto) */}
        {hoverPoint && !visualSel && (
          <HoverReadout px={toPx(hoverPoint.ts.getTime())} point={hoverPoint} yScale={yScale} innerHeight={innerHeight} innerWidth={innerWidth} />
        )}
        {hoverPoint && visualSel && dragRef.current == null && (
          <HoverReadout px={toPx(hoverPoint.ts.getTime())} point={hoverPoint} yScale={yScale} innerHeight={innerHeight} innerWidth={innerWidth} subtle />
        )}

        {/* Agulhas */}
        {visualSel && (
          <>
            <Needle px={toPx(visualSel.a)} t={visualSel.a} innerHeight={innerHeight} innerWidth={innerWidth} align="left" />
            <Needle px={toPx(visualSel.b)} t={visualSel.b} innerHeight={innerHeight} innerWidth={innerWidth} align="right" />
          </>
        )}

        <AxisLeft
          scale={yScale}
          numTicks={4}
          stroke={COLOR_AXIS}
          tickStroke={COLOR_AXIS}
          tickLabelProps={() => ({ fill: COLOR_TEXT, fontSize: 10, textAnchor: 'end', dx: -4, dy: 3 })}
        />
        <AxisBottom
          scale={xScale}
          top={innerHeight}
          numTicks={Math.min(7, Math.max(2, visible.length))}
          tickFormat={(v) => tickFormatter(v as Date)}
          stroke={COLOR_AXIS}
          tickStroke={COLOR_AXIS}
          tickLabelProps={() => ({ fill: COLOR_TEXT, fontSize: 10, textAnchor: 'middle', dy: 4 })}
        />

        {/* Marca d'água — central e grande; a opacidade baixa mantém as séries legíveis. */}
        <text
          x={innerWidth / 2}
          y={innerHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.max(20, Math.min(innerWidth / 12, 40))}
          fontWeight={600}
          letterSpacing={6}
          fill={COLOR_WATERMARK}
          style={{ textTransform: 'uppercase', pointerEvents: 'none' }}
        >
          norya.io
        </text>

        {/* Camada de interação */}
        <rect
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          style={{ cursor: cursorFor(hoverX), touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHoverX(null)}
          onDoubleClick={() => { onCommit(null); onZoom(null); }}
        />
      </Group>

      {/* Legenda some enquanto há recorte — a faixa do topo é das agulhas. */}
      {!visualSel && (
        <g transform={`translate(${margin.left}, 6)`}>
          <rect width={10} height={3} y={6} fill={COLOR_MSGS} />
          <text x={14} y={10} fontSize={10} fill={COLOR_TEXT}>mensagens</text>
          <rect width={10} height={3} y={6} x={90} fill={COLOR_USERS} />
          <text x={104} y={10} fontSize={10} fill={COLOR_TEXT}>usuários únicos</text>
        </g>
      )}
    </svg>
  );
}

/** Agulha estilo timeline: linha + cabeça arrastável + hora em cima. */
function Needle({
  px, t, innerHeight, innerWidth, align,
}: { px: number; t: number; innerHeight: number; innerWidth: number; align: 'left' | 'right' }) {
  if (px < -12 || px > innerWidth + 12) return null;
  const label = formatHour(new Date(t));
  const labelW = 40;
  // Etiqueta não estoura as bordas do plot
  const lx = Math.min(innerWidth - labelW / 2, Math.max(labelW / 2, px));
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={px} x2={px} y1={-6} y2={innerHeight} stroke={COLOR_MSGS} strokeWidth={1.5} />
      {/* cabeça da agulha (bandeirinha) */}
      <path
        d={align === 'left'
          ? `M ${px} -6 h 7 a 2.5 2.5 0 0 1 2.5 2.5 v 5 l -9.5 6 z`
          : `M ${px} -6 h -7 a 2.5 2.5 0 0 0 -2.5 2.5 v 5 l 9.5 6 z`}
        fill={COLOR_MSGS}
      />
      <rect x={lx - labelW / 2} y={-24} width={labelW} height={16} rx={8} fill="rgba(20,22,12,0.92)" stroke={COLOR_MSGS} strokeOpacity={0.5} />
      <text x={lx} y={-12} textAnchor="middle" fontSize={10} fill={COLOR_MSGS} className="tabular-nums">
        {label}
      </text>
    </g>
  );
}

/** Crosshair + leitura de hora/valores no hover. */
function HoverReadout({
  px, point, yScale, innerHeight, innerWidth, subtle,
}: {
  px: number;
  point: Point;
  yScale: ReturnType<typeof scaleLinear<number>>;
  innerHeight: number;
  innerWidth: number;
  subtle?: boolean;
}) {
  const boxW = 118;
  const bx = px + 10 + boxW > innerWidth ? px - 10 - boxW : px + 10;
  return (
    <g style={{ pointerEvents: 'none' }} opacity={subtle ? 0.55 : 1}>
      <line x1={px} x2={px} y1={0} y2={innerHeight} stroke="rgba(255,255,255,0.22)" strokeDasharray="3,3" />
      <circle cx={px} cy={yScale(point.msgs) ?? 0} r={3.5} fill={COLOR_MSGS} />
      <circle cx={px} cy={yScale(point.users) ?? 0} r={3} fill={COLOR_USERS} />
      <rect x={bx} y={8} width={boxW} height={46} rx={8} fill="rgba(20,22,12,0.92)" stroke="rgba(255,255,255,0.12)" />
      <text x={bx + 10} y={22} fontSize={10} fill={COLOR_TEXT} className="tabular-nums">
        {formatHour(point.ts)}
      </text>
      <text x={bx + 10} y={35} fontSize={10} fill={COLOR_MSGS} className="tabular-nums">
        {point.msgs} mensagens
      </text>
      <text x={bx + 10} y={48} fontSize={10} fill={COLOR_USERS} className="tabular-nums">
        {point.users} usuários
      </text>
    </g>
  );
}

// ─── controles ─────────────────────────────────────────────────────────────

interface DateChipProps {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function DateChip({ active, onClick, children }: DateChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium tracking-tight ' +
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 ' +
        (active
          ? 'border-accent-400/30 bg-accent-400/10 text-accent-300 shadow-[inset_0_0_0_1px_rgba(215,254,1,0.18)]'
          : 'border-white/[0.08] bg-white/[0.04] text-ink-600 hover:bg-white/[0.07] hover:text-ink-800 hover:border-white/[0.14]')
      }
    >
      {children}
    </button>
  );
}

interface IconBtnProps {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  'aria-label': string;
}

function IconBtn({ onClick, disabled, children, ...rest }: IconBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex h-8 w-8 items-center justify-center text-ink-600 transition-colors ' +
        'hover:bg-white/[0.06] hover:text-ink-800 ' +
        'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60'
      }
      {...rest}
    >
      {children}
    </button>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function ZoomIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35M8 11h6M11 8v6" />
    </svg>
  );
}

// ─── DayThumb ──────────────────────────────────────────────────────────────

const thumbDayLabel = timeFormat('%d/%m');

/**
 * Miniatura de um dia da seleção: sparkline de mensagens + total do dia.
 * Usa a MESMA queryKey do gráfico grande — focar um dia já encontra os
 * dados quentes no cache.
 */
function DayThumb({
  channelId, ymd, active, limit, onClick,
}: {
  channelId: string;
  ymd: string;
  active: boolean;
  limit: number;
  onClick: () => void;
}) {
  const bounds = dayBoundsIso(ymd);
  const q = useQuery({
    queryKey: ['insights-history', channelId, 'chart', ymd, limit],
    queryFn: () => api.get<InsightsHistoryResponse>(
      `/api/v2/social-listening/insights/history?channelId=${encodeURIComponent(channelId)}` +
        `&from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}&limit=${limit}`,
    ),
    staleTime: ymd === todayYmd() ? 30_000 : 5 * 60_000,
  });

  const { path, total } = useMemo(() => {
    const items = q.data?.items ?? [];
    const msgs = [...items].reverse().map((b: BatchAnalysis) => b.messageCount);
    const total_ = msgs.reduce((a, b) => a + b, 0);
    if (msgs.length < 2) return { path: null, total: total_ };
    const W = 120;
    const H = 30;
    const peak = Math.max(...msgs, 1);
    const pts = msgs.map((m, i) => {
      const x = (i / (msgs.length - 1)) * W;
      const y = H - (m / peak) * (H - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { path: `M0,${H} L${pts.join(' L')} L${W},${H} Z`, total: total_ };
  }, [q.data]);

  const [y, m, d] = parseYmd(ymd);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Focar ${formatYmdLabel(ymd)} no gráfico`}
      className={
        'flex flex-shrink-0 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-colors ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 ' +
        (active
          ? 'border-accent-400/50 bg-accent-400/[0.08]'
          : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.16]')
      }
    >
      <span className="flex w-full items-baseline justify-between gap-3">
        <span className={'text-[11px] font-semibold tabular-nums ' + (active ? 'text-accent-300' : 'text-ink-700')}>
          {thumbDayLabel(new Date(y, m - 1, d))}
        </span>
        <span className="text-[10px] text-ink-400">
          {q.isLoading ? '…' : `${total.toLocaleString('pt-BR')} msgs`}
        </span>
      </span>
      <svg width="120" height="30" aria-hidden className="overflow-visible">
        {path ? (
          <path d={path} fill={active ? 'rgba(215,254,1,0.28)' : 'rgba(215,254,1,0.12)'} stroke={COLOR_MSGS} strokeWidth="1" />
        ) : (
          <line x1="0" y1="29" x2="120" y2="29" stroke={COLOR_AXIS} strokeDasharray="3 3" />
        )}
      </svg>
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// ─── CalendarPopover ───────────────────────────────────────────────────────

const DOW_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface CalendarPopoverProps {
  value: string; // ymd em foco (define o mês inicial)
  /** Dias selecionados — clique alterna inclusão/exclusão (multi-dia). */
  selected: string[];
  maxYmd: string; // limite superior (ex: hoje)
  /** Toggle de um dia; o popover fica aberto pra permitir vários cliques. */
  onToggle: (ymd: string) => void;
  /** Reset da seleção para um único dia (atalho "Hoje") — fecha o popover. */
  onReset: (ymd: string) => void;
  onClose: () => void;
}

function CalendarPopover({ value, selected, maxYmd, onToggle, onReset, onClose }: CalendarPopoverProps) {
  const [vy, vm] = parseYmd(value);
  const [year, setYear] = useState(vy);
  const [month, setMonth] = useState(vm - 1); // 0-based
  const [pickingYear, setPickingYear] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const today = todayYmd();

  // Fechar ao clicar fora ou ESC
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const [maxY, maxM, maxD] = parseYmd(maxYmd);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setYear(y);
    setMonth(m);
  }

  const canForward = year < maxY || (year === maxY && month < maxM - 1);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Selecionar data"
      className={
        'absolute right-0 top-[calc(100%+8px)] z-50 w-72 origin-top-right rounded-2xl ' +
        'border border-white/[0.08] bg-bg-1/95 p-3 shadow-elevated'
      }
      style={{ backdropFilter: 'blur(20px)' }}
    >
      {/* Header: mês/ano + chevrons */}
      <div className="mb-3 flex items-center justify-between gap-1">
        <IconBtn aria-label="Mês anterior" onClick={() => shiftMonth(-1)}>
          <ChevronLeft />
        </IconBtn>

        <button
          type="button"
          onClick={() => setPickingYear((v) => !v)}
          className={
            'flex-1 rounded-lg px-2 py-1 text-sm font-medium tracking-tight text-ink-800 ' +
            'transition-colors hover:bg-white/[0.06] focus:outline-none ' +
            'focus-visible:ring-2 focus-visible:ring-accent-400/60'
          }
        >
          {MONTH_NAMES[month]} <span className="text-ink-500">{year}</span>
        </button>

        <IconBtn aria-label="Próximo mês" onClick={() => shiftMonth(1)} disabled={!canForward}>
          <ChevronRight />
        </IconBtn>
      </div>

      {pickingYear ? (
        <YearGrid
          current={year}
          maxYear={maxY}
          onPick={(y) => {
            setYear(y);
            setPickingYear(false);
          }}
        />
      ) : (
        <>
          {/* Cabeçalho dos dias da semana */}
          <div className="mb-1 grid grid-cols-7 gap-1">
            {DOW_LABELS.map((d, i) => (
              <div
                key={i}
                className="flex h-7 items-center justify-center text-[10px] font-medium uppercase tracking-wider text-ink-500"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid de dias */}
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell, i) => {
              if (cell === null) {
                return <div key={i} className="h-8" />;
              }
              const ymd = formatYmdParts(year, month, cell);
              const isSelected = selected.includes(ymd);
              const isToday_ = ymd === today;
              const isDisabled =
                year > maxY ||
                (year === maxY && month > maxM - 1) ||
                (year === maxY && month === maxM - 1 && cell > maxD);

              return (
                <button
                  key={i}
                  type="button"
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  onClick={() => onToggle(ymd)}
                  className={
                    'flex h-8 w-full items-center justify-center rounded-lg text-xs font-medium tabular-nums ' +
                    'transition-all duration-150 focus:outline-none ' +
                    'focus-visible:ring-2 focus-visible:ring-accent-400/60 ' +
                    (isDisabled
                      ? 'cursor-not-allowed text-ink-500/30'
                      : isSelected
                        ? 'bg-gradient-to-br from-accent-300 via-accent-400 to-accent-600 text-bg-0 shadow-[0_4px_12px_rgba(215,254,1,0.30)]'
                        : isToday_
                          ? 'text-accent-300 ring-1 ring-inset ring-accent-400/40 hover:bg-accent-400/10'
                          : 'text-ink-700 hover:bg-white/[0.06] hover:text-ink-800')
                  }
                >
                  {cell}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Footer: atalho pra hoje + contagem da seleção */}
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
        <button
          type="button"
          onClick={() => onReset(today)}
          className="rounded-md px-2 py-1 text-xs font-medium text-accent-300 transition-colors hover:bg-accent-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
        >
          Hoje
        </button>
        <span className="text-[10px] text-ink-500">
          {selected.length > 1 ? `${selected.length} dias · ` : ''}clique alterna o dia · esc fecha
        </span>
      </div>
    </div>
  );
}

interface YearGridProps {
  current: number;
  maxYear: number;
  onPick: (year: number) => void;
}

function YearGrid({ current, maxYear, onPick }: YearGridProps) {
  // Janela de 12 anos ao redor do atual
  const start = current - 6;
  const years = Array.from({ length: 12 }, (_, i) => start + i);
  return (
    <div className="grid grid-cols-3 gap-1">
      {years.map((y) => {
        const disabled = y > maxYear;
        const selected = y === current;
        return (
          <button
            key={y}
            type="button"
            disabled={disabled}
            onClick={() => onPick(y)}
            className={
              'flex h-9 items-center justify-center rounded-lg text-xs font-medium tabular-nums transition-all ' +
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 ' +
              (disabled
                ? 'cursor-not-allowed text-ink-500/30'
                : selected
                  ? 'bg-gradient-to-br from-accent-300 via-accent-400 to-accent-600 text-bg-0 shadow-[0_4px_12px_rgba(215,254,1,0.30)]'
                  : 'text-ink-700 hover:bg-white/[0.06] hover:text-ink-800')
            }
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}

// Devolve um array de 6×7 (42 células) representando o grid do mês.
// Posições antes do dia 1 e depois do último vêm como null.
function buildMonthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const lead = first.getDay(); // 0=Dom
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);
  return cells;
}

function formatYmdParts(y: number, monthZeroBased: number, d: number): string {
  const m = String(monthZeroBased + 1).padStart(2, '0');
  const day = String(d).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
