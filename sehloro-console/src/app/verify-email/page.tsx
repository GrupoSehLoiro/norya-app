'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Ambient } from '@/components/layout/ambient';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api-client';

const RESEND_COOLDOWN_S = 30;

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const { verifyEmail, resendCode } = useAuth();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!/^\d{6}$/.test(code)) {
      setServerError('O código tem 6 dígitos.');
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmail(email, code);
      // OnboardingGuard (Fase 4) leva ao /onboarding se ainda não concluído.
      router.push('/onboarding');
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : 'Código inválido. Tente de novo.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (cooldown > 0) return;
    setServerError(null);
    setResent(false);
    try {
      await resendCode(email);
      setResent(true);
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setServerError('Não foi possível reenviar agora.');
    }
  }

  return (
    <>
      <Ambient />
      <main className="relative z-10 grid min-h-screen place-items-center p-6">
        <form onSubmit={onSubmit} className="glass-card w-full max-w-sm space-y-4">
          <div className="mb-2 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ink-800">
              Confirme seu email
            </h1>
            <p className="mt-1 text-sm text-ink-400">
              Enviamos um código de 6 dígitos para
              <br />
              <span className="text-ink-700">{email || 'seu email'}</span>.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
              Código
            </label>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-lg tracking-[0.5em]"
            />
          </div>

          {serverError && (
            <div className="rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
              {serverError}
            </div>
          )}
          {resent && !serverError && (
            <div className="rounded-lg border border-accent-400/30 bg-accent-400/[0.08] px-3 py-2 text-sm text-ink-700">
              Novo código enviado.
            </div>
          )}

          <Button type="submit" className="w-full" loading={submitting} size="lg">
            Confirmar
          </Button>

          <div className="flex items-center justify-between text-xs text-ink-400">
            <button
              type="button"
              onClick={onResend}
              disabled={cooldown > 0}
              className="text-accent-400 hover:underline disabled:text-ink-400 disabled:no-underline"
            >
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
            </button>
            <Link href="/login" className="hover:underline">
              Voltar ao login
            </Link>
          </div>
        </form>
      </main>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
