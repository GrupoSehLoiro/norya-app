'use client';

/**
 * /logs — access logs da API + worker, via GET /api/v2/logs.
 *
 * O endpoint usa Basic Auth OPERACIONAL (LOGS_USER/LOGS_PASSWORD do .env do
 * backend), separada do JWT do console — por isso a página pede credencial
 * própria antes de consultar. A credencial vive só em sessionStorage (morre
 * com a aba) e um 401 derruba de volta pro formulário.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { AdminGate } from '@/components/auth/admin-gate';

const CRED_STORAGE_KEY = 'sehloro:logs-basic';

interface AccessLogItem {
  service: 'api' | 'worker';
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  ip: string;
  userAgent: string;
  userId: string | null;
  traceId: string;
  at: string;
}

interface LogsResponse {
  total: number;
  items: AccessLogItem[];
}

interface Filters {
  service: '' | 'api' | 'worker';
  method: string;
  onlyErrors: boolean;
  path: string;
  limit: number;
}

const DEFAULT_FILTERS: Filters = { service: '', method: '', onlyErrors: false, path: '', limit: 100 };

function loadCred(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(CRED_STORAGE_KEY);
}

function statusTone(status: number): 'positive' | 'warn' | 'negative' | 'neutral' {
  if (status >= 500) return 'negative';
  if (status >= 400) return 'warn';
  if (status >= 200 && status < 300) return 'positive';
  return 'neutral';
}

export default function LogsPage() {
  return (
    <AdminGate>
      <LogsInner />
    </AdminGate>
  );
}

function LogsInner() {
  const [cred, setCred] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => setCred(loadCred()), []);

  const handleUnauthorized = useCallback(() => {
    window.sessionStorage.removeItem(CRED_STORAGE_KEY);
    setCred(null);
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.service) p.set('service', filters.service);
    if (filters.method) p.set('method', filters.method);
    if (filters.onlyErrors) p.set('statusGte', '400');
    if (filters.path.trim()) p.set('path', filters.path.trim());
    p.set('limit', String(filters.limit));
    return p.toString();
  }, [filters]);

  const logs = useQuery<LogsResponse>({
    enabled: Boolean(cred),
    queryKey: ['access-logs', query],
    refetchInterval: autoRefresh ? 5000 : false,
    queryFn: async () => {
      const res = await fetch(`/api/v2/logs?${query}`, {
        headers: { Authorization: `Basic ${cred}`, Accept: 'application/json' },
      });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Credencial de logs inválida');
      }
      if (res.status === 404) {
        throw new Error('Endpoint de logs desligado — configure LOGS_USER/LOGS_PASSWORD no backend');
      }
      if (!res.ok) throw new Error(`Falha ao consultar logs (HTTP ${res.status})`);
      return res.json() as Promise<LogsResponse>;
    },
  });

  if (!cred) {
    return <CredentialGate onSubmit={(value) => setCred(value)} />;
  }

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Admin"
        title="Access logs"
        description="Quem acessou o quê — requests da API e eventos EventSub do worker (endpoint /api/v2/logs, retenção 14 dias)."
      />

      <Card padding="sm">
        <div className="flex flex-wrap items-end gap-3 p-2">
          <FilterSelect
            label="Serviço"
            value={filters.service}
            onChange={(v) => setFilters((f) => ({ ...f, service: v as Filters['service'] }))}
            options={[
              { value: '', label: 'todos' },
              { value: 'api', label: 'api' },
              { value: 'worker', label: 'worker' },
            ]}
          />
          <FilterSelect
            label="Método"
            value={filters.method}
            onChange={(v) => setFilters((f) => ({ ...f, method: v }))}
            options={[
              { value: '', label: 'todos' },
              ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'EVENT'].map((m) => ({ value: m, label: m })),
            ]}
          />
          <div className="min-w-[220px] flex-1">
            <FieldLabel>Path contém</FieldLabel>
            <Input
              value={filters.path}
              onChange={(e) => setFilters((f) => ({ ...f, path: e.target.value }))}
              placeholder="/api/v2/channels"
            />
          </div>
          <FilterSelect
            label="Limite"
            value={String(filters.limit)}
            onChange={(v) => setFilters((f) => ({ ...f, limit: Number(v) }))}
            options={['50', '100', '200', '500'].map((n) => ({ value: n, label: n }))}
          />
          <label className="flex h-10 cursor-pointer items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={filters.onlyErrors}
              onChange={(e) => setFilters((f) => ({ ...f, onlyErrors: e.target.checked }))}
              className="accent-current"
            />
            só erros (≥400)
          </label>
          <label className="flex h-10 cursor-pointer items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-current"
            />
            auto-refresh 5s
          </label>
          <Button variant="secondary" size="md" onClick={() => void logs.refetch()} loading={logs.isFetching}>
            Atualizar
          </Button>
        </div>
      </Card>

      {logs.error && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          {(logs.error as Error).message}
        </div>
      )}

      {logs.isLoading ? (
        <Card>carregando…</Card>
      ) : (
        <Card padding="sm">
          <div className="flex items-center justify-between px-2 pb-2">
            <p className="text-xs uppercase tracking-[0.14em] text-ink-400">
              {logs.data?.total ?? 0} registro(s) no filtro — exibindo {logs.data?.items.length ?? 0}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-[10px] uppercase tracking-[0.14em] text-ink-400">
                  <th className="px-2 py-2 font-medium">Quando</th>
                  <th className="px-2 py-2 font-medium">Serviço</th>
                  <th className="px-2 py-2 font-medium">Método</th>
                  <th className="px-2 py-2 font-medium">Path</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">ms</th>
                  <th className="px-2 py-2 font-medium">User</th>
                  <th className="px-2 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {logs.data?.items.map((item, i) => (
                  <tr key={`${item.traceId}-${item.at}-${i}`} className="transition-colors hover:bg-white/[0.025]">
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-ink-600">
                      {new Date(item.at).toLocaleString('pt-BR', { hour12: false })}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={item.service === 'api' ? 'accent' : 'neutral'}>{item.service}</Badge>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-ink-800">{item.method}</td>
                    <td className="max-w-[320px] truncate px-2 py-2 font-mono text-xs text-ink-800" title={item.path}>
                      {item.path}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={statusTone(item.statusCode)}>{item.statusCode}</Badge>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-ink-600">{item.responseTimeMs}</td>
                    <td className="max-w-[140px] truncate px-2 py-2 font-mono text-xs text-ink-600" title={item.userId ?? ''}>
                      {item.userId ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-ink-600">{item.ip || '—'}</td>
                  </tr>
                ))}
                {(logs.data?.items.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-8 text-center text-sm text-ink-400">
                      nenhum registro para o filtro atual
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function CredentialGate({ onSubmit }: { onSubmit: (encoded: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Admin"
        title="Access logs"
        description="Área protegida por credencial operacional (LOGS_USER/LOGS_PASSWORD do .env do backend)."
      />
      <Card className="max-w-md">
        <CardHeader title="Autenticação de logs" description="Credencial separada do login do console." />
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!username || !password) return;
            const encoded = btoa(`${username}:${password}`);
            window.sessionStorage.setItem(CRED_STORAGE_KEY, encoded);
            onSubmit(encoded);
          }}
        >
          <div>
            <FieldLabel>Usuário</FieldLabel>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <FieldLabel>Senha</FieldLabel>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!username || !password}>
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-ink-400">{children}</p>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 transition-colors focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-bg-0">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
