'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { AdminGate } from '@/components/auth/admin-gate';
import { api, ApiError } from '@/lib/api-client';
import type { FeatureFlag } from '@/lib/types';

export default function FeatureFlagsPage() {
  return (
    <AdminGate>
      <FeatureFlagsInner />
    </AdminGate>
  );
}

function FeatureFlagsInner() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const flags = useQuery({
    queryKey: ['feature-flags'],
    queryFn: () => api.get<FeatureFlag[]>('/api/v2/feature-flags'),
  });

  const toggle = useMutation({
    mutationFn: (input: { key: string; defaultValue: boolean }) =>
      api.patch(`/api/v2/feature-flags/${encodeURIComponent(input.key)}`, {
        defaultValue: input.defaultValue,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'falha'),
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Admin"
        title="Feature flags"
        description="Liga e desliga funcionalidades por canal, usuário ou porcentagem."
      />

      {error && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          {error}
        </div>
      )}

      {flags.isLoading ? (
        <Card>carregando…</Card>
      ) : (
        <Card padding="sm">
          <ul className="divide-y divide-white/[0.05]">
            {flags.data?.map((f) => (
              <li key={f.key} className="flex items-center justify-between py-3 px-2 transition-colors hover:bg-white/[0.025] rounded-lg">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-ink-800">{f.key}</p>
                  <p className="mt-0.5 text-xs text-ink-400">{f.description || 'sem descrição'}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-400">
                    {(f.rules?.length ?? 0)} regra(s)
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <Badge tone={f.defaultValue ? 'positive' : 'neutral'}>
                    default: {String(f.defaultValue)}
                  </Badge>
                  <button
                    onClick={() => toggle.mutate({ key: f.key, defaultValue: !f.defaultValue })}
                    disabled={toggle.isPending}
                    aria-label={`toggle ${f.key}`}
                    className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
                      f.defaultValue
                        ? 'border-accent-200 bg-gradient-to-br from-accent-400 to-accent-600 shadow-[0_0_14px_rgba(215,254,1,0.30)]'
                        : 'border-white/[0.10] bg-white/[0.08]'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
                        f.defaultValue
                          ? 'left-[18px] bg-bg-0'
                          : 'left-0.5 bg-white/55'
                      }`}
                    />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
