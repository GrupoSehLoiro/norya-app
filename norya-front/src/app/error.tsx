'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Ambient } from '@/components/layout/ambient';

export default function GlobalError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[ConsoleErrorBoundary]', error);
  }, [error]);

  return (
    <>
      <Ambient />
      <div className="relative z-10 grid min-h-screen place-items-center p-6">
        <div className="glass-card w-full max-w-md">
          <h1 className="text-lg font-bold tracking-tight text-err">Algo quebrou no front</h1>
          <p className="mt-2 text-sm text-ink-600">
            {error.message || 'Erro desconhecido'}
          </p>
          {error.digest && (
            <p className="mt-1 font-mono text-xs text-ink-400">digest: {error.digest}</p>
          )}
          <div className="mt-4 flex gap-2">
            <Button onClick={reset}>Tentar novamente</Button>
            <Button variant="secondary" onClick={() => { window.location.href = '/dashboard'; }}>
              Ir para dashboard
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
