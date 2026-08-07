'use client';

/**
 * Custo de IA (admin) — tetos de tokens por canal, pausa e uso do mês.
 *
 * O admin controla o gasto SEM deploy: os valores salvos aqui chegam ao
 * orchestrator em <1min (cache 45s do LlmBudgetSettingsService). Herança:
 * override do canal → defaults globais → env → default de fábrica.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { AdminGate } from '@/components/auth/admin-gate';
import { ApiError } from '@/lib/api-client';
import {
  deleteChannelBudget,
  fetchBudgetOverview,
  fmtTokens,
  fmtUsd,
  patchBudgetDefaults,
  putChannelBudget,
  resetChannelMonth,
  type BudgetOverview,
  type BudgetPatch,
  type ChannelBudgetRow,
} from '@/lib/ai-budget';

export default function AiBudgetPage() {
  return (
    <AdminGate>
      <AiBudgetInner />
    </AdminGate>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  channel: 'override do canal',
  global: 'default global',
  env: 'env',
  default: 'fábrica',
};

function useBudget() {
  return useQuery({
    queryKey: ['ai-budget'],
    queryFn: fetchBudgetOverview,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function AiBudgetInner() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const overview = useBudget();

  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? `${e.status}: ${e.message}` : 'falha na operação');
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-budget'] });

  return (
    <div className="flex flex-col gap-8 pb-20">
      <PageHeader
        eyebrow="Admin"
        title="Custo de IA"
        description="Tetos de tokens por canal, pausa e consumo do mês — aplicados no pipeline em menos de 1 minuto, sem deploy."
      />

      {error && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          {error}
          <button className="ml-3 underline" onClick={() => setError(null)}>
            fechar
          </button>
        </div>
      )}

      {overview.isLoading || !overview.data ? (
        <Card>carregando…</Card>
      ) : (
        <>
          {!overview.data.redisAvailable && (
            <div className="rounded-2xl border border-warn/30 bg-warn/[0.08] px-4 py-3 text-sm text-warn">
              Redis indisponível — os tetos não estão sendo aplicados (fail-open) e o consumo não
              pode ser medido.
            </div>
          )}
          <DefaultsCard data={overview.data} onDone={refresh} onError={onError} />
          <ChannelsTable data={overview.data} onDone={refresh} onError={onError} />
        </>
      )}
    </div>
  );
}

// ─── Defaults globais ────────────────────────────────────────────────────────

function DefaultsCard({
  data,
  onDone,
  onError,
}: {
  data: BudgetOverview;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const { global, env, hardDefaults } = data.defaults;
  const effMonthly = global?.monthlyTokens ?? env.monthlyTokens ?? hardDefaults.monthlyTokens;
  const effMinute = global?.tokensPerMinute ?? env.tokensPerMinute ?? hardDefaults.tokensPerMinute;

  const [editing, setEditing] = useState(false);
  const [monthly, setMonthly] = useState('');
  const [minute, setMinute] = useState('');

  const save = useMutation({
    mutationFn: (patch: BudgetPatch) => patchBudgetDefaults(patch),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
    onError,
  });

  const startEdit = () => {
    setMonthly(String(global?.monthlyTokens ?? ''));
    setMinute(String(global?.tokensPerMinute ?? ''));
    setEditing(true);
  };

  const submit = () => {
    save.mutate({
      monthlyTokens: monthly.trim() ? Number(monthly) : undefined,
      tokensPerMinute: minute.trim() ? Number(minute) : undefined,
      paused: Boolean(global?.paused),
    });
  };

  const togglePauseAll = () =>
    save.mutate({
      monthlyTokens: global?.monthlyTokens,
      tokensPerMinute: global?.tokensPerMinute,
      paused: !global?.paused,
    });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-800">Defaults globais</h2>
          <p className="mt-1 text-xs text-ink-400">
            Valem para todo canal sem override. Herança: global → env → fábrica (
            {fmtTokens(hardDefaults.monthlyTokens)}/mês, {fmtTokens(hardDefaults.tokensPerMinute)}
            /min).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-ink-800">
            <span>
              <span className="text-ink-400">mensal:</span> {fmtTokens(effMonthly)} tokens
            </span>
            <span>
              <span className="text-ink-400">por minuto:</span> {fmtTokens(effMinute)} tokens
            </span>
            {global?.updatedBy && (
              <span className="text-xs text-ink-400">último ajuste: {global.updatedBy}</span>
            )}
            {global?.paused && <Badge tone="negative">TUDO PAUSADO</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <Button variant="ghost" onClick={startEdit}>
              Editar tetos
            </Button>
          )}
          <Button
            variant={global?.paused ? 'primary' : 'ghost'}
            disabled={save.isPending}
            onClick={togglePauseAll}
            title="Pausa/retoma a IA de TODOS os canais (botão de pânico)"
          >
            {global?.paused ? 'Retomar tudo' : 'Pausar tudo'}
          </Button>
        </div>
      </div>

      {editing && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/[0.05] pt-4">
          <label className="flex flex-col gap-1 text-xs text-ink-400">
            Teto mensal (tokens) — vazio herda da env
            <Input
              className="w-48"
              inputMode="numeric"
              placeholder={String(env.monthlyTokens ?? hardDefaults.monthlyTokens)}
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-400">
            Teto por minuto (tokens)
            <Input
              className="w-40"
              inputMode="numeric"
              placeholder={String(env.tokensPerMinute ?? hardDefaults.tokensPerMinute)}
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
            />
          </label>
          <Button disabled={save.isPending} onClick={submit}>
            Salvar
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── Tabela por canal ────────────────────────────────────────────────────────

function ChannelsTable({
  data,
  onDone,
  onError,
}: {
  data: BudgetOverview;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  return (
    <Card padding="sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-400">
              <th className="px-2 py-2">Canal</th>
              <th className="px-2 py-2 text-right">Custo (mês)</th>
              <th className="px-2 py-2">Uso do teto mensal</th>
              <th className="px-2 py-2">Origem</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {data.channels.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-ink-400">
                  Nenhum canal ativo.
                </td>
              </tr>
            )}
            {data.channels.map((row) => (
              <ChannelRow key={row.channelId} row={row} onDone={onDone} onError={onError} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ChannelRow({
  row,
  onDone,
  onError,
}: {
  row: ChannelBudgetRow;
  onDone: () => void;
  onError: (e: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [monthly, setMonthly] = useState('');
  const [minute, setMinute] = useState('');

  const put = useMutation({
    mutationFn: (patch: BudgetPatch) => putChannelBudget(row.channelId, patch),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteChannelBudget(row.channelId),
    onSuccess: onDone,
    onError,
  });
  const reset = useMutation({
    mutationFn: () => resetChannelMonth(row.channelId),
    onSuccess: onDone,
    onError,
  });

  const pct =
    row.usedMonthlyTokens != null
      ? Math.min(100, Math.round((row.usedMonthlyTokens / row.effective.monthlyTokens) * 100))
      : null;

  const startEdit = () => {
    setMonthly(String(row.override?.monthlyTokens ?? ''));
    setMinute(String(row.override?.tokensPerMinute ?? ''));
    setEditing(true);
  };

  const togglePause = () =>
    put.mutate({
      monthlyTokens: row.override?.monthlyTokens,
      tokensPerMinute: row.override?.tokensPerMinute,
      paused: !(row.override?.paused ?? false),
    });

  return (
    <>
      <tr className="transition-colors hover:bg-white/[0.02]">
        <td className="px-2 py-3">
          <div className="font-medium text-ink-800">{row.name}</div>
          <div className="text-xs text-ink-400">{row.channelId}</div>
        </td>
        <td className="px-2 py-3 text-right tabular-nums text-ink-800">
          {fmtUsd(row.costUsdMonth)}
        </td>
        <td className="px-2 py-3">
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-ink-800">
              {fmtTokens(row.usedMonthlyTokens)} / {fmtTokens(row.effective.monthlyTokens)}
            </span>
            {pct != null && (
              <span className="text-xs text-ink-400 tabular-nums">({pct}%)</span>
            )}
          </div>
          {pct != null && (
            <div className="mt-1 h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={
                  'h-full rounded-full ' +
                  (pct >= 100 ? 'bg-err' : pct >= 80 ? 'bg-warn' : 'bg-accent-400')
                }
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <div className="mt-1 text-[11px] text-ink-400">
            throttle: {fmtTokens(row.effective.tokensPerMinute)}/min
          </div>
        </td>
        <td className="px-2 py-3">
          <Badge tone={row.effective.source === 'channel' ? 'accent' : 'neutral'}>
            {SOURCE_LABEL[row.effective.source] ?? row.effective.source}
          </Badge>
        </td>
        <td className="px-2 py-3">
          {row.status === 'paused' && <Badge tone="negative">pausado</Badge>}
          {row.status === 'blocked_monthly' && <Badge tone="warn">teto atingido</Badge>}
          {row.status === 'ok' && <Badge tone="positive">ativo</Badge>}
        </td>
        <td className="px-2 py-3">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={editing ? () => setEditing(false) : startEdit}>
              {editing ? 'Fechar' : 'Editar'}
            </Button>
            <Button size="sm" variant="ghost" disabled={put.isPending} onClick={togglePause}>
              {(row.override?.paused ?? false) ? 'Retomar' : 'Pausar'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={reset.isPending}
              title="Zera o contador do mês (concede budget imediatamente)"
              onClick={() => reset.mutate()}
            >
              Reset mês
            </Button>
            {row.override && (
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                title="Remove o override — o canal volta a herdar os defaults"
                onClick={() => remove.mutate()}
              >
                Herdar
              </Button>
            )}
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6} className="px-2 pb-4">
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <label className="flex flex-col gap-1 text-xs text-ink-400">
                Teto mensal (tokens) — vazio herda
                <Input
                  className="w-44"
                  inputMode="numeric"
                  placeholder={String(row.effective.monthlyTokens)}
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-400">
                Teto por minuto (tokens) — vazio herda
                <Input
                  className="w-40"
                  inputMode="numeric"
                  placeholder={String(row.effective.tokensPerMinute)}
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                />
              </label>
              <Button
                size="sm"
                disabled={put.isPending}
                onClick={() =>
                  put.mutate({
                    monthlyTokens: monthly.trim() ? Number(monthly) : undefined,
                    tokensPerMinute: minute.trim() ? Number(minute) : undefined,
                    paused: row.override?.paused ?? false,
                  })
                }
              >
                Salvar override
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
