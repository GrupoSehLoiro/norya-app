'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe, useEntitlements } from '@/hooks/use-me';
import { api, setToken } from '@/lib/api-client';
import { fmtLimit } from '@/lib/billing';
import { cn } from '@/lib/utils';
import type { AuthTokensLite } from '@/lib/types';

/**
 * Chip de workspace ativo no Topbar: nome do workspace + plano + uso de canais
 * vs. limite. Se houver mais de um workspace, vira um seletor (troca o token
 * via /workspace/:id/activate).
 */
export function WorkspaceChip() {
  const me = useMe();
  const ent = useEntitlements();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (!me.data) return null;
  const active = me.data.workspaces.find((w) => w.id === me.data!.activeWorkspaceId);
  const multi = me.data.workspaces.length > 1;
  const planLabel = ent.data?.plan.label ?? active?.planKey ?? 'free';
  const usage = ent.data
    ? `${ent.data.usage.creators}/${fmtLimit(ent.data.limits.maxCreators)} canais`
    : null;

  async function activate(id: string) {
    setSwitching(true);
    try {
      const res = await api.post<AuthTokensLite>(`/api/v2/auth/workspace/${id}/activate`);
      setToken(res.accessToken);
      await qc.invalidateQueries();
      window.location.reload();
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  }

  return (
    <div className="relative hidden md:block md:justify-self-start">
      <button
        type="button"
        onClick={() => multi && setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs',
          multi ? 'hover:bg-white/[0.07] cursor-pointer' : 'cursor-default',
        )}
      >
        <span className="font-medium text-ink-800">{active?.name ?? 'Workspace'}</span>
        <span className="rounded-full bg-accent-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-400">
          {planLabel}
        </span>
        {usage && <span className="text-ink-400">· {usage}</span>}
        {multi && <span className="text-ink-400">▾</span>}
      </button>

      {open && multi && (
        <ul className="absolute left-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-white/[0.1] bg-bg-1 p-1 shadow-elevated">
          {me.data.workspaces.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={switching}
                onClick={() => activate(w.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-white/[0.06]',
                  w.id === me.data!.activeWorkspaceId ? 'text-ink-800' : 'text-ink-600',
                )}
              >
                <span>{w.name}</span>
                <span className="text-[10px] uppercase text-ink-400">{w.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
