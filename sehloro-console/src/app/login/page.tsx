'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Ambient } from '@/components/layout/ambient';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api-client';

const Schema = z.object({
  email: z.string().email('email inválido'),
  password: z.string().min(1, 'preencha a senha'),
});
type FormData = z.infer<typeof Schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>();

  async function onSubmit(values: FormData) {
    setServerError(null);
    const parsed = Schema.safeParse(values);
    if (!parsed.success) {
      setServerError(parsed.error.errors[0]?.message ?? 'dados inválidos');
      return;
    }
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        // Conta ainda não verificada → manda para a confirmação de email.
        const code = (err.payload as { code?: string } | undefined)?.code;
        if (code === 'EMAIL_NOT_VERIFIED') {
          router.push(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
          return;
        }
        setServerError(err.message);
      } else {
        setServerError('Falha ao entrar — verifique suas credenciais.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Ambient />
      <main className="relative z-10 grid min-h-screen place-items-center p-6">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="glass-card w-full max-w-sm space-y-4"
        >
          <div className="mb-2 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ink-800">SLMod Console</h1>
            <p className="mt-1 text-sm text-ink-400">Entre com seu email.</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
              Email
            </label>
            <Input
              type="email"
              autoComplete="email"
              placeholder="voce@exemplo.com"
              {...register('email')}
            />
            {errors.email && <p className="mt-1 text-xs text-err">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
              Senha
            </label>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              {...register('password')}
            />
            {errors.password && <p className="mt-1 text-xs text-err">{errors.password.message}</p>}
          </div>

          {serverError && (
            <div className="rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
              {serverError}
            </div>
          )}

          <Button type="submit" className="w-full" loading={submitting} size="lg">
            Entrar
          </Button>
          <p className="text-center text-xs text-ink-400">
            Não tem conta?{' '}
            <Link href="/signup" className="text-accent-400 hover:underline">
              Criar conta
            </Link>
          </p>
        </form>
      </main>
    </>
  );
}
