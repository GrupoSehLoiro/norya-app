'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '@/lib/auth';
import { fetchEntitlements } from '@/lib/billing';
import type { WsRole } from '@/lib/types';

/** Contexto de tenancy do usuário logado (workspaces, role, onboarding). */
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 30_000 });
}

/** Entitlements (plano + uso) do workspace ativo. */
export function useEntitlements() {
  return useQuery({
    queryKey: ['entitlements'],
    queryFn: fetchEntitlements,
    staleTime: 30_000,
  });
}

/** `true` se o role pode gerenciar recursos (manager/admin/owner). */
export function canManage(role: WsRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}
