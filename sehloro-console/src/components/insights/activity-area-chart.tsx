'use client';

/**
 * Area chart de atividade do chat ao longo da janela monitorada.
 *
 * Eixo X = windowStart (tempo).
 * Y1 = messageCount (área principal — engagement signal).
 * Y2 = uniqueUsers   (área secundária — diversidade da audiência).
 *
 * Backend ainda não tem viewer_count via Helix; por isso plotamos
 * msgs + users como proxy.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { api, getToken } from '@/lib/api-client';
import type { BatchAnalysis, InsightsHistoryResponse } from '@/lib/types';

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayYmd(): string {
  return ymdFromDate(new Date());
}

// Faz o parse de um 'YYYY-MM-DD' numa tupla [ano, mês, dia] de números.
// Necessário porque com `noUncheckedIndexedAccess` o destructure de
// `.split('-').map(Number)` tipa cada elemento como `number | undefined`.
function parseYmd(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = parseYmd(ymd);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return ymdFromDate(dt);
}

function dayBoundsIso(ymd: string): { from: string; to: string } {
  // ymd vem do <input type="date"> no timezone local. Construímos
  // o intervalo [00:00, 23:59:59.999] local e mandamos em ISO UTC.
  const [y, m, d] = parseYmd(ymd);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

const longDate = timeFormat('%a, %d %b %Y');
function formatYmdLabel(ymd: string): string {
  const [y, m, d] = parseYmd(ymd);
  return longDate(new Date(y, m - 1, d));
}

interface Point {
  ts: Date;
  msgs: number;
  users: number;
}

const COLOR_MSGS = '#d7fe01';   // lime accent
const COLOR_USERS = '#a78bfa';  // twitch purple, contrast pair
const COLOR_GRID = 'rgba(255,255,255,0.06)';
const COLOR_AXIS = 'rgba(255,255,255,0.18)';
const COLOR_TEXT = 'rgba(255,255,255,0.60)';

const formatHour = timeFormat('%H:%M');
const formatDate = timeFormat('%d/%m %H:%M');

interface Props {
  channelId: string | null;
  limit?: number;
}

export function ActivityAreaChart({ channelId, limit = 500 }: Props) {
  const [date, setDate] = useState<string>(todayYmd());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { from, to } = useMemo(() => dayBoundsIso(date), [date]);
  const isToday = date === todayYmd();

  async function handleExport() {
    if (!channelId || exporting) return;
    setExporting(true);
    try {
      const token = getToken();
      const url =
        `/api/v2/social-listening/batches/export/csv?channelId=${encodeURIComponent(channelId)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        alert(`Falha ao exportar CSV: HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `batches-${channelId}-${date}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      alert(`Falha ao exportar CSV: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  // Relatório PDF: o backend agrega os batches do período visível, gera o
  // texto pela IA (mesma dos batches) e devolve o PDF pra baixar.
  async function handlePdf() {
    if (!channelId || pdfLoading) return;
    setPdfLoading(true);
    try {
      const token = getToken();
      const url =
        `/api/v2/social-listening/insights/report.pdf?channelId=${encodeURIComponent(channelId)}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
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
    // Refresh ao vivo só faz sentido pro dia de hoje; dias passados são imutáveis.
    refetchInterval: isToday ? 15_000 : false,
  });

  const points: Point[] = useMemo(() => {
    if (!history.data?.items) return [];
    return [...history.data.items]
      .reverse()
      .map((b: BatchAnalysis) => ({
        ts: new Date(b.windowStart),
        msgs: b.messageCount,
        users: b.uniqueUsers,
      }));
  }, [history.data]);

  const today = todayYmd();
  const yesterday = shiftYmd(today, -1);
  const isYesterday = date === yesterday;
  const canGoForward = date < today;

  return (
    <Card>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {channelId ? (
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                loading={exporting}
                onClick={handleExport}
              >
                {!exporting && <DownloadIcon />}
                CSV
              </Button>
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
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="eyebrow mb-2">{isToday ? 'Atividade ao vivo' : 'Histórico'}</p>
            <h2 className="text-base font-semibold tracking-tight text-ink-800">
              Atividade do chat ao longo da live
            </h2>
            <p className="mt-1 text-sm text-ink-400">
              Mensagens (lime) + usuários únicos (roxo) por batch de 15s
            </p>
          </div>
        </div>
        {channelId ? (
          <div className="flex flex-wrap items-center gap-2">
              <DateChip active={isToday} onClick={() => setDate(today)}>
                Hoje
              </DateChip>
              <DateChip active={isYesterday} onClick={() => setDate(yesterday)}>
                Ontem
              </DateChip>

              <div className="relative">
                <div className="flex items-center overflow-hidden rounded-full border border-white/[0.08] bg-white/[0.04]">
                  <IconBtn
                    aria-label="Dia anterior"
                    onClick={() => setDate(shiftYmd(date, -1))}
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
                    <span className="tabular-nums">{formatYmdLabel(date)}</span>
                  </button>

                  <IconBtn
                    aria-label="Próximo dia"
                    onClick={() => setDate(shiftYmd(date, 1))}
                    disabled={!canGoForward}
                  >
                    <ChevronRight />
                  </IconBtn>
                </div>

                {pickerOpen && (
                  <CalendarPopover
                    value={date}
                    maxYmd={today}
                    onSelect={(ymd) => {
                      setDate(ymd);
                      setPickerOpen(false);
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>

              <Badge tone="accent">{points.length} batches</Badge>
          </div>
        ) : null}
      </div>
      {!channelId ? (
        <p className="text-sm text-ink-400">Selecione um canal pra ver o gráfico.</p>
      ) : history.isLoading ? (
        <p className="text-sm text-ink-400">carregando…</p>
      ) : points.length === 0 ? (
        <p className="text-sm text-ink-400">
          {isToday
            ? 'Sem batches hoje — abra uma live e o gráfico se preenche.'
            : 'Sem batches nesta data.'}
        </p>
      ) : (
        <div className="h-72 w-full">
          <ParentSize>
            {({ width, height }) => (
              <ChartInner width={width} height={height} points={points} />
            )}
          </ParentSize>
        </div>
      )}
    </Card>
  );
}

interface ChartInnerProps {
  width: number;
  height: number;
  points: Point[];
}

function ChartInner({ width, height, points }: ChartInnerProps) {
  const margin = { top: 16, right: 16, bottom: 28, left: 36 };
  const innerWidth = Math.max(0, width - margin.left - margin.right);
  const innerHeight = Math.max(0, height - margin.top - margin.bottom);
  if (innerWidth <= 0 || innerHeight <= 0) return null;

  const xExtent = extent(points, (p) => p.ts) as [Date, Date];
  const yMax = Math.max(
    max(points, (p) => p.msgs) ?? 0,
    max(points, (p) => p.users) ?? 0,
    5,
  );
  const xScale = scaleTime({ domain: xExtent, range: [0, innerWidth] });
  const yScale = scaleLinear({ domain: [0, yMax * 1.15], range: [innerHeight, 0], nice: true });

  const spanMinutes = (xExtent[1].getTime() - xExtent[0].getTime()) / 60_000;
  const tickFormatter = spanMinutes > 90 ? formatDate : formatHour;

  return (
    <svg width={width} height={height} aria-label="atividade do chat">
      <defs>
        <linearGradient id="grad-msgs" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={COLOR_MSGS} stopOpacity={0.40} />
          <stop offset="100%" stopColor={COLOR_MSGS} stopOpacity={0.02} />
        </linearGradient>
        <linearGradient id="grad-users" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={COLOR_USERS} stopOpacity={0.30} />
          <stop offset="100%" stopColor={COLOR_USERS} stopOpacity={0.02} />
        </linearGradient>
      </defs>

      <Group left={margin.left} top={margin.top}>
        {yScale.ticks(4).map((t) => (
          <line
            key={String(t)}
            x1={0} x2={innerWidth} y1={yScale(t)} y2={yScale(t)}
            stroke={COLOR_GRID} strokeDasharray="2,3"
          />
        ))}

        <AreaClosed<Point>
          data={points}
          x={(d) => xScale(d.ts) ?? 0}
          y={(d) => yScale(d.msgs) ?? 0}
          yScale={yScale}
          fill="url(#grad-msgs)"
          curve={curveMonotoneX}
        />
        <LinePath<Point>
          data={points}
          x={(d) => xScale(d.ts) ?? 0}
          y={(d) => yScale(d.msgs) ?? 0}
          stroke={COLOR_MSGS} strokeWidth={2} curve={curveMonotoneX}
        />

        <AreaClosed<Point>
          data={points}
          x={(d) => xScale(d.ts) ?? 0}
          y={(d) => yScale(d.users) ?? 0}
          yScale={yScale}
          fill="url(#grad-users)"
          curve={curveMonotoneX}
        />
        <LinePath<Point>
          data={points}
          x={(d) => xScale(d.ts) ?? 0}
          y={(d) => yScale(d.users) ?? 0}
          stroke={COLOR_USERS} strokeWidth={1.5} strokeDasharray="4,3" curve={curveMonotoneX}
        />

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
          numTicks={Math.min(6, points.length)}
          tickFormat={(v) => tickFormatter(v as Date)}
          stroke={COLOR_AXIS}
          tickStroke={COLOR_AXIS}
          tickLabelProps={() => ({ fill: COLOR_TEXT, fontSize: 10, textAnchor: 'middle', dy: 4 })}
        />
      </Group>

      <g transform={`translate(${margin.left}, 4)`}>
        <rect width={10} height={3} y={6} fill={COLOR_MSGS} />
        <text x={14} y={10} fontSize={10} fill={COLOR_TEXT}>mensagens</text>
        <rect width={10} height={3} y={6} x={90} fill={COLOR_USERS} />
        <text x={104} y={10} fontSize={10} fill={COLOR_TEXT}>usuários únicos</text>
      </g>
    </svg>
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
  value: string; // ymd
  maxYmd: string; // limite superior (ex: hoje)
  onSelect: (ymd: string) => void;
  onClose: () => void;
}

function CalendarPopover({ value, maxYmd, onSelect, onClose }: CalendarPopoverProps) {
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
              const isSelected = ymd === value;
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
                  onClick={() => onSelect(ymd)}
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

      {/* Footer: atalho pra hoje */}
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
        <button
          type="button"
          onClick={() => onSelect(today)}
          className="rounded-md px-2 py-1 text-xs font-medium text-accent-300 transition-colors hover:bg-accent-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
        >
          Hoje
        </button>
        <span className="text-[10px] text-ink-500">esc pra fechar</span>
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
