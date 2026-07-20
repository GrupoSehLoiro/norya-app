'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pie } from '@visx/shape';
import { Group } from '@visx/group';
import type { BatchAnalysis } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InsightText } from '@/components/ui/insight-text';
import { api, ApiError } from '@/lib/api-client';
import { fetchWindowInsight } from '@/lib/analytics';
import { classifySentiment, formatPct } from '@/lib/utils';

interface InsightCardsProps {
  analysis: BatchAnalysis;
  /**
   * Quando passado, sobrescreve `analysis.marcasMencionadas` no card de
   * marcas. Útil pra exibir agregação cumulativa (ex.: últimos 20 batches)
   * ao invés de só a janela de 15s do último batch — janelas curtas
   * raramente têm menção de marca, então o aggregate é melhor UX.
   */
  brandsOverride?: BatchAnalysis['marcasMencionadas'];
  channelId: string;
  /** Período selecionado no topo da página — usado no contexto por marca. */
  from: string;
  to: string;
}

const SLICE_COLORS = {
  pos: '#6ee7b7', // token ok
  neu: 'rgba(255,255,255,0.35)',
  neg: '#f87171', // token err
} as const;

export function InsightCards({ analysis, brandsOverride, channelId, from, to }: InsightCardsProps) {
  const sent = classifySentiment(analysis.climaGeral);
  const brands = brandsOverride ?? analysis.marcasMencionadas;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* #1 — Clima geral (pizza) */}
      <Card>
        <p className="eyebrow">Clima geral</p>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <SentimentDonut clima={analysis.climaGeral} />
          <div>
            <p className={`text-2xl font-bold tracking-tight ${sent.color}`}>{sent.label}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-600">
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SLICE_COLORS.pos }} aria-hidden />
                Positivo <b className="text-ink-800">{formatPct(analysis.climaGeral.pos)}</b>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SLICE_COLORS.neu }} aria-hidden />
                Neutro <b className="text-ink-800">{formatPct(analysis.climaGeral.neu)}</b>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SLICE_COLORS.neg }} aria-hidden />
                Negativo <b className="text-ink-800">{formatPct(analysis.climaGeral.neg)}</b>
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* #2 — Pauta mais comentada (quadro maior, descrição em destaque) */}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <p className="eyebrow">Pauta mais comentada</p>
          {analysis.pautaMaisComentada && analysis.pautaMaisComentada.count > 0 && (
            <span className="text-xs text-ink-400">{analysis.pautaMaisComentada.count} menções</span>
          )}
        </div>
        {analysis.pautaMaisComentada ? (
          <>
            <p className="mt-2 text-2xl font-bold tracking-tight text-ink-800">
              {analysis.pautaMaisComentada.category}
            </p>
            {analysis.pautaMaisComentada.context ? (
              <p className="mt-3 border-l-2 border-accent-400/50 pl-3 text-[15px] leading-relaxed text-ink-700">
                {analysis.pautaMaisComentada.context}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-sm text-ink-400">—</p>
        )}
      </Card>

      {/* #3 — Marcas mencionadas: clique numa marca gera o contexto via IA;
          o "+" adiciona novas palavras/marcas ao monitoramento. */}
      <BrandsCard brands={brands} channelId={channelId} from={from} to={to} />
    </div>
  );
}

function SentimentDonut({ clima }: { clima: { pos: number; neu: number; neg: number } }) {
  const size = 132;
  const radius = size / 2;
  const data = [
    { key: 'pos', value: clima.pos },
    { key: 'neu', value: clima.neu },
    { key: 'neg', value: clima.neg },
  ].filter((d) => d.value > 0.0001);

  return (
    <svg width={size} height={size} role="img" aria-label="Distribuição de sentimento">
      <Group top={radius} left={radius}>
        <Pie
          data={data}
          pieValue={(d) => d.value}
          pieSortValues={null}
          outerRadius={radius - 2}
          innerRadius={radius * 0.55}
          padAngle={0.04}
          cornerRadius={4}
        >
          {(pie) =>
            pie.arcs.map((arc) => (
              <path
                key={arc.data.key}
                d={pie.path(arc) ?? ''}
                fill={SLICE_COLORS[arc.data.key as keyof typeof SLICE_COLORS]}
              />
            ))
          }
        </Pie>
      </Group>
    </svg>
  );
}

function BrandsCard({
  brands, channelId, from, to,
}: {
  brands: BatchAnalysis['marcasMencionadas'];
  channelId: string;
  from: string;
  to: string;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  const [addMsg, setAddMsg] = useState<string | null>(null);

  // Contexto da marca clicada — resumo das mensagens que a mencionam no
  // período. A busca é por substring: normaliza o nome ("Coca-Cola" → "coca")
  // pra casar com a grafia solta do chat.
  const searchTerm = selected
    ? (selected.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)[0] ?? selected)
    : null;
  const context = useQuery({
    enabled: !!selected,
    queryKey: ['brand-context', channelId, searchTerm, from, to],
    queryFn: () => fetchWindowInsight(channelId, { from, to, q: searchTerm! }),
    staleTime: 60_000,
  });

  const addMut = useMutation({
    mutationFn: (name: string) =>
      api.post('/api/v2/social-listening/brands', { channelId, name }),
    onSuccess: (_data, name) => {
      setAddMsg(`“${name}” adicionada — novas menções passam a ser monitoradas.`);
      setNewBrand('');
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['brands', channelId] });
    },
    onError: (err) => {
      setAddMsg(err instanceof ApiError ? err.message : 'Falha ao adicionar a marca.');
    },
  });

  return (
    <Card className="sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Marcas mencionadas</p>
        <button
          type="button"
          onClick={() => { setAdding((v) => !v); setAddMsg(null); }}
          aria-label="Adicionar palavra/marca"
          title="Adicionar palavra/marca para monitorar"
          className={
            'inline-flex h-7 w-7 items-center justify-center rounded-full border text-base leading-none ' +
            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 ' +
            (adding
              ? 'border-accent-400/40 bg-accent-400/15 text-accent-300'
              : 'border-white/[0.10] bg-white/[0.04] text-ink-500 hover:text-ink-800')
          }
        >
          +
        </button>
      </div>

      {adding && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newBrand.trim().length >= 2) addMut.mutate(newBrand.trim());
          }}
        >
          <Input
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            placeholder="ex: redbull"
            aria-label="Nova palavra/marca"
          />
          <Button type="submit" size="sm" loading={addMut.isPending}>Adicionar</Button>
        </form>
      )}
      {addMsg && <p className="mt-2 text-xs text-ink-400">{addMsg}</p>}

      {brands.length === 0 ? (
        <p className="mt-3 text-sm text-ink-400">Nenhuma marca monitorada apareceu no chat ainda.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {brands.map((b) => {
            const active = selected === b.brand;
            return (
              <li key={b.brand}>
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : b.brand)}
                  aria-pressed={active}
                  title={`Ver contexto de ${b.brand}`}
                  className={
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors ' +
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60 ' +
                    (active
                      ? 'border-accent-400/40 bg-accent-400/10'
                      : 'border-white/[0.08] bg-white/[0.04] hover:border-white/[0.16]')
                  }
                >
                  <span className="text-sm font-semibold text-ink-800">{b.brand}</span>
                  <Badge tone="accent">{b.count}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-800">
              Contexto: {selected}
              {context.data ? (
                <span className="ml-2 text-xs font-normal text-ink-400">
                  {context.data.total} mensagens no período
                </span>
              ) : null}
            </p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-ink-400 hover:text-ink-700"
            >
              fechar ✕
            </button>
          </div>
          {context.isLoading ? (
            <p className="mt-2 text-sm text-ink-400">gerando contexto…</p>
          ) : context.isError ? (
            <p className="mt-2 text-sm text-err">Não foi possível gerar o contexto agora.</p>
          ) : context.data ? (
            <>
              <InsightText className="mt-2 space-y-2 text-sm leading-relaxed text-ink-700" text={context.data.insight} />
              <div className="mt-2">
                <Badge tone={context.data.aiEnabled ? 'positive' : 'neutral'}>
                  {context.data.aiEnabled ? 'resumo via IA' : 'resumo básico'}
                </Badge>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
