'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Ambient } from '@/components/layout/ambient';
import { useAuth } from '@/hooks/use-auth';
import { api, ApiError } from '@/lib/api-client';

const Schema = z.object({
  username: z.string().min(3, 'nome de usuário muito curto'),
  email: z.string().email('email inválido'),
  password: z.string().min(6, 'senha precisa ter ao menos 6 chars'),
});
type FormData = z.infer<typeof Schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>();

  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  async function onSubmit(values: FormData) {
    setServerError(null);
    setSuccess(null);
    const parsed = Schema.safeParse(values);
    if (!parsed.success) {
      setServerError(parsed.error.errors[0]?.message ?? 'dados inválidos');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/users', parsed.data);
      setSuccess(`Conta criada para ${parsed.data.email}.`);
      reset();
    } catch (err) {
      if (err instanceof ApiError) setServerError(err.message);
      else setServerError('Falha ao criar conta.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return null;

  return (
    <>
      <Ambient />
      <main className="relative z-10 grid min-h-screen place-items-center p-6">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="glass-card w-full max-w-sm space-y-4"
        >
          <div className="mb-2 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-ink-800">Criar conta</h1>
            <p className="mt-1 text-sm text-ink-400">
              Apenas admins podem criar contas — o servidor valida o JWT.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">Username</label>
            <Input placeholder="mod_user1" {...register('username')} />
            {errors.username && <p className="mt-1 text-xs text-err">{errors.username.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">Email</label>
            <Input type="email" placeholder="email@exemplo.com" {...register('email')} />
            {errors.email && <p className="mt-1 text-xs text-err">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">Senha</label>
            <Input type="password" placeholder="••••••" {...register('password')} />
            {errors.password && <p className="mt-1 text-xs text-err">{errors.password.message}</p>}
          </div>

          {serverError && (
            <div className="rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">{serverError}</div>
          )}
          {success && (
            <div className="rounded-lg border border-ok/30 bg-ok/[0.08] px-3 py-2 text-sm text-ok">{success}</div>
          )}

          <Button type="submit" className="w-full" loading={submitting} size="lg">
            Criar conta
          </Button>
          <p className="text-center text-xs text-ink-400">
            <Link href="/dashboard" className="text-accent-300 hover:text-accent-400 hover:underline">Voltar</Link>
          </p>
        </form>
      </main>
    </>
  );
}
