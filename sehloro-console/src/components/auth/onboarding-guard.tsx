'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from '@/hooks/use-me';

/**
 * Gate de onboarding (roda dentro do AuthGuard, já autenticado): consulta /me e
 * redireciona para /verify-email (se email não confirmado) ou /onboarding (se o
 * onboarding não foi concluído). Só libera o dashboard com onboarding completo.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isLoading, isError } = useMe();

  useEffect(() => {
    if (!data) return;
    if (!data.user.emailVerified) {
      router.replace(`/verify-email?email=${encodeURIComponent(data.user.email)}`);
    } else if (!data.user.onboardingCompleted) {
      router.replace('/onboarding');
    }
  }, [data, router]);

  // Em erro de /me (ex.: token de outra instância) deixa passar — o api-client
  // já trata 401 com redirect pro login.
  if (isLoading || (data && !data.user.onboardingCompleted) || (data && !data.user.emailVerified)) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
      </div>
    );
  }
  if (isError) return <>{children}</>;
  return <>{children}</>;
}
