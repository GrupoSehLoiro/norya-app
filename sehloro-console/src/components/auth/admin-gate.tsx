'use client';

/**
 * AdminGate — barreira de render para páginas do grupo Admin (adminOnly).
 *
 * O sumiço do item na sidebar NÃO é proteção: a rota continua acessível por
 * URL direta. Este gate bloqueia o render para role global != 'admin' (a
 * mesma claim que o backend valida nos endpoints admin — a decisão final é
 * sempre do servidor; aqui é UX de não deixar nem ver).
 */
import type { ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

export function AdminGate({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();

  if (!ready) return null;

  if (user?.role !== 'admin') {
    return (
      <Card>
        <CardHeader
          title="Acesso negado"
          description="Esta área é exclusiva de administradores. Fale com um admin pela gestão de acesso se precisar de permissão."
        />
      </Card>
    );
  }

  return <>{children}</>;
}
