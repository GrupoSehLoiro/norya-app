'use client';

/**
 * /access — Gerenciador de acesso (grupo Admin).
 *
 * ÚNICO lugar onde se cria usuário admin (o sign-up público sempre nasce
 * role=user — o backend nem aceita role no registro). Consome
 * /api/v2/admin/users, que exige role global admin no JWT.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/layout/page-header';
import { AdminGate } from '@/components/auth/admin-gate';
import { useAuth } from '@/hooks/use-auth';
import { api, ApiError } from '@/lib/api-client';

interface AdminUserView {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: 'admin' | 'moderator' | 'user' | string;
  status: string;
  emailVerified: boolean;
}

const ROLES: Array<'admin' | 'moderator' | 'user'> = ['admin', 'moderator', 'user'];

function roleTone(role: string): 'accent' | 'warn' | 'neutral' {
  if (role === 'admin') return 'accent';
  if (role === 'moderator') return 'warn';
  return 'neutral';
}

export default function AccessPage() {
  return (
    <AdminGate>
      <AccessManager />
    </AdminGate>
  );
}

function AccessManager() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<AdminUserView[]>('/api/v2/admin/users'),
  });

  const changeRole = useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      api.patch(`/api/v2/admin/users/${encodeURIComponent(input.id)}/role`, { role: input.role }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'falha ao trocar papel'),
  });

  // Alvo do modal de confirmação de exclusão (null = fechado).
  const [toDelete, setToDelete] = useState<AdminUserView | null>(null);
  const deleteUser = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v2/admin/users/${encodeURIComponent(id)}`),
    onSuccess: (_data, id) => {
      const target = users.data?.find((u) => u.id === id);
      setNotice(`Usuário ${target?.email ?? id} apagado, junto com todos os dados dele.`);
      setError(null);
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => {
      setNotice(null);
      setError(e instanceof ApiError ? e.message : 'falha ao apagar usuário');
      setToDelete(null);
    },
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Admin"
        title="Gerenciador de acesso"
        description="Criação de usuários com papel (inclusive admin) e troca de papéis. O registro público cria apenas usuário comum."
      />

      {error && (
        <div className="rounded-2xl border border-err/30 bg-err/[0.08] px-4 py-3 text-sm text-err">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-2xl border border-ok/30 bg-ok/[0.08] px-4 py-3 text-sm text-ok">
          {notice}
        </div>
      )}

      <CreateUserCard
        onCreated={(u) => {
          setNotice(`Usuário ${u.email} criado com papel ${u.role}.`);
          setError(null);
          void qc.invalidateQueries({ queryKey: ['admin-users'] });
        }}
        onError={(msg) => {
          setNotice(null);
          setError(msg);
        }}
      />

      {users.isLoading ? (
        <Card>carregando…</Card>
      ) : (
        <Card padding="sm">
          <div className="px-2 pb-2">
            <p className="text-xs uppercase tracking-[0.14em] text-ink-400">
              {users.data?.length ?? 0} usuário(s)
            </p>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {users.data?.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-white/[0.025]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {u.displayName || u.email}
                    {u.id === me?.sub && <span className="ml-2 text-xs text-ink-400">(você)</span>}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-ink-400">{u.email}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <Badge tone={u.status === 'active' ? 'positive' : 'warn'}>{u.status}</Badge>
                  <Badge tone={roleTone(u.role)}>{u.role}</Badge>
                  <select
                    value={u.role}
                    disabled={u.id === me?.sub || changeRole.isPending}
                    onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value })}
                    title={u.id === me?.sub ? 'Você não pode alterar o próprio papel' : 'Trocar papel'}
                    className="h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-xs text-ink-800 transition-colors focus:border-accent-400/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r} className="bg-bg-0">
                        {r}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={u.id === me?.sub || deleteUser.isPending}
                    onClick={() => setToDelete(u)}
                    title={
                      u.id === me?.sub
                        ? 'Você não pode apagar o próprio usuário'
                        : 'Apagar usuário e todos os dados dele'
                    }
                  >
                    Apagar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {toDelete ? (
        <Modal
          onClose={() => (deleteUser.isPending ? undefined : setToDelete(null))}
          title="Apagar usuário?"
          maxWidth="max-w-md"
          ariaLabel="Confirmar exclusão de usuário"
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-700">
              Tem certeza que quer apagar{' '}
              <b className="text-ink-800">{toDelete.displayName || toDelete.email}</b>{' '}
              (<span className="font-mono text-xs">{toDelete.email}</span>)?
            </p>
            <p className="rounded-xl border border-err/30 bg-err/[0.08] px-3 py-2.5 text-xs text-err">
              Essa ação é irreversível: apaga o usuário e TUDO que pertence a ele —
              workspaces, canais conectados (Twitch/Kick), tokens, sessões de live,
              análises e relatórios.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setToDelete(null)}
                disabled={deleteUser.isPending}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                loading={deleteUser.isPending}
                onClick={() => deleteUser.mutate(toDelete.id)}
              >
                Apagar definitivamente
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function CreateUserCard({
  onCreated,
  onError,
}: {
  onCreated: (u: AdminUserView) => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'admin' | 'moderator' | 'user'>('admin');

  const create = useMutation({
    mutationFn: () =>
      api.post<AdminUserView>('/api/v2/admin/users', {
        email,
        password,
        displayName: displayName.trim() || undefined,
        role,
      }),
    onSuccess: (u) => {
      setEmail('');
      setPassword('');
      setDisplayName('');
      onCreated(u);
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : 'falha ao criar usuário'),
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title="Criar usuário"
        description="Nasce ativo e com email verificado, sem fluxo de código. Papel admin dá acesso a todo o grupo Admin."
      />
      <form
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!email || password.length < 8) return;
          create.mutate();
        }}
      >
        <div>
          <FieldLabel>Email</FieldLabel>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <FieldLabel>Senha (mín. 8)</FieldLabel>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
        </div>
        <div>
          <FieldLabel>Nome (opcional)</FieldLabel>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Papel</FieldLabel>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 transition-colors focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20"
          >
            {ROLES.map((r) => (
              <option key={r} value={r} className="bg-bg-0">
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" loading={create.isPending} disabled={!email || password.length < 8}>
            Criar usuário
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-ink-400">{children}</p>;
}
