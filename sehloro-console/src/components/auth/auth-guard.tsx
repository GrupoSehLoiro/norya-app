'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  if (!ready) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
