'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function RootPage() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [ready, user, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-accent-600 border-t-transparent" />
    </main>
  );
}
