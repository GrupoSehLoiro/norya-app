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
  /** Query/body da request e body da response — sanitizados no backend
   *  ([REDACTED] em campos sensíveis) e ausentes quando vazios. */
  query?: unknown;
  requestBody?: unknown;
  responseBody?: unknown;
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

const CSV_COLUMNS = [
  'at',
  'service',
  'method',
  'path',
  'statusCode',
  'responseTimeMs',
  'ip',
  'userAgent',
  'userId',
  'traceId',
  'query',
  'requestBody',
  'responseBody',
] as const;

function toCsv(items: AccessLogItem[]): string {
  const esc = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const s = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : JSON.stringify(value);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map((item) => CSV_COLUMNS.map((col) => esc(item[col])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const [downloading, setDownloading] = useState<'json' | 'csv' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Snapshot da lista no momento do clique: o auto-refresh de 5s pode
  // reordenar/trocar os itens, e a navegação ←/→ do modal deve seguir a
  // ordem que o usuário estava vendo quando abriu.
  const [detail, setDetail] = useState<{ items: AccessLogItem[]; index: number } | null>(null);

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

  // Refaz a mesma consulta filtrada (mesmo query string da listagem) e baixa
  // o resultado como arquivo — o que se vê no filtro é o que sai no download.
  const downloadLogs = useCallback(
    async (format: 'json' | 'csv') => {
      if (!cred) return;
      setDownloading(format);
      setDownloadError(null);
      try {
        const res = await fetch(`/api/v2/logs?${query}`, {
          headers: { Authorization: `Basic ${cred}`, Accept: 'application/json' },
        });
        if (res.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!res.ok) throw new Error(`Falha ao baixar logs (HTTP ${res.status})`);
        const data = (await res.json()) as LogsResponse;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const blob =
          format === 'json'
            ? new Blob([JSON.stringify(data.items, null, 2)], { type: 'application/json' })
            : // BOM para o Excel abrir o UTF-8 corretamente.
              new Blob(['\ufeff' + toCsv(data.items)], { type: 'text/csv;charset=utf-8' });
        saveBlob(blob, `access-logs-${stamp}.${format}`);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Falha ao baixar logs');
      } finally {
        setDownloading(null);
      }
    },
    [cred, query, handleUnauthorized],
  );

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
          <Button
            variant="ghost"
            size="md"
            onClick={() => void downloadLogs('json')}
            loading={downloading === 'json'}
            disabled={downloading !== null}
          >
            Baixar JSON
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => void downloadLogs('csv')}
            loading={downloading === 'csv'}
            disabled={downloading !== null}
          >
            Baixar CSV
          </Button>
        </div>
      </Card>

      {logs.error && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          {(logs.error as Error).message}
        </div>
      )}

      {downloadError && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          {downloadError}
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
                  <th className="px-2 py-2 font-medium">
                    <span className="sr-only">Detalhes</span>
                  </th>
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
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setDetail({ items: logs.data?.items ?? [], index: i })}
                        className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-ink-400 transition-colors hover:border-accent-400/40 hover:bg-white/[0.07] hover:text-accent-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
                        title="Ver log completo"
                        aria-label="Ver log completo"
                      >
                        <MagnifierIcon />
                      </button>
                    </td>
                  </tr>
                ))}
                {(logs.data?.items.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={9} className="px-2 py-8 text-center text-sm text-ink-400">
                      nenhum registro para o filtro atual
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {detail && (
        <LogDetailModal
          items={detail.items}
          index={detail.index}
          onNavigate={(index) => setDetail((d) => (d ? { ...d, index } : d))}
          onClose={() => setDetail(null)}
        />
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

/**
 * Modal de detalhe de um log: JSON completo formatado + navegação ←/→ na
 * ordem da lista de onde o usuário clicou (snapshot — imune ao auto-refresh).
 * Teclado: Esc fecha, setas navegam.
 */
function LogDetailModal({
  items,
  index,
  onNavigate,
  onClose,
}: {
  items: AccessLogItem[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onNavigate(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onNavigate, onClose]);

  // Trava o scroll da página enquanto o modal está aberto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => setCopied(false), [index]);

  if (!item) return null;

  const json = JSON.stringify(item, null, 2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe do log"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-bg-1 shadow-elevated">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-400">
              log {index + 1} de {items.length} —{' '}
              {new Date(item.at).toLocaleString('pt-BR', { hour12: false })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={item.service === 'api' ? 'accent' : 'neutral'}>{item.service}</Badge>
              <Badge tone={statusTone(item.statusCode)}>{item.statusCode}</Badge>
              <span className="font-mono text-xs font-semibold text-ink-800">{item.method}</span>
              <span className="min-w-0 truncate font-mono text-xs text-ink-600" title={item.path}>
                {item.path}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-ink-400 transition-colors hover:border-white/[0.14] hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <JsonView json={json} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(json).then(() => setCopied(true));
            }}
          >
            {copied ? 'copiado ✓' : 'copiar JSON'}
          </Button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate(index - 1)}
              disabled={!hasPrev}
              aria-label="Log anterior"
              title="Log anterior (←)"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-2 text-ink-600 transition-colors hover:border-accent-400/40 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.08] disabled:hover:text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
            >
              <ChevronIcon direction="left" />
            </button>
            <span className="min-w-[72px] text-center font-mono text-xs text-ink-400">
              {index + 1} / {items.length}
            </span>
            <button
              type="button"
              onClick={() => onNavigate(index + 1)}
              disabled={!hasNext}
              aria-label="Próximo log"
              title="Próximo log (→)"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-2 text-ink-600 transition-colors hover:border-accent-400/40 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/[0.08] disabled:hover:text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60"
            >
              <ChevronIcon direction="right" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** JSON pretty-printed com highlight leve de sintaxe (sem lib externa). */
function JsonView({ json }: { json: string }) {
  const tokens = json.split(
    /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  );
  return (
    <pre className="whitespace-pre-wrap break-all rounded-xl border border-white/[0.06] bg-black/30 p-4 font-mono text-xs leading-relaxed text-ink-400">
      {tokens.map((token, i) => {
        if (!token) return null;
        let cls: string | undefined;
        if (/^"(?:\\.|[^"\\])*"\s*:$/.test(token)) cls = 'text-accent-300';
        else if (token.startsWith('"')) cls = 'text-ok';
        else if (/^(?:true|false|null)$/.test(token)) cls = 'text-platform-twitch';
        else if (/^-?\d/.test(token)) cls = 'text-warn';
        return (
          <span key={i} className={cls}>
            {token}
          </span>
        );
      })}
    </pre>
  );
}

function MagnifierIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.2" y2="16.2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
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
