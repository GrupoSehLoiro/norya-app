'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  MenuRow,
  Scenic,
  ScenicPanel,
  SButton,
  SDivider,
  SError,
  SInput,
  SLabel,
} from '@/components/auth/scenic';
import { IconChevronRight } from '@/components/ui/icons';
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
        setServerError(err.message);
      } else {
        setServerError('Falha ao entrar. Verifique suas credenciais.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Scenic />
      <main className="relative z-10 grid min-h-screen place-items-center p-6">
        <ScenicPanel className="w-full max-w-sm">
          <div className="px-4 pb-3 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d7fe01]">
              Norya
            </p>
            <h1 className="mt-1.5 text-xl font-bold tracking-tight text-[#eef1f5]">Entrar</h1>
            <p className="mt-0.5 text-sm text-[rgba(255,255,255,0.45)]">Entre com seu email.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 pb-3">
            <div>
              <SLabel>Email</SLabel>
              <SInput
                type="email"
                autoComplete="email"
                placeholder="voce@exemplo.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-[#fca5a5]">{errors.email.message}</p>
              )}
            </div>
            <div>
              <SLabel>Senha</SLabel>
              <SInput
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-[#fca5a5]">{errors.password.message}</p>
              )}
            </div>

            {serverError && <SError>{serverError}</SError>}

            <SButton type="submit" className="w-full" loading={submitting}>
              Entrar
            </SButton>
          </form>

          <SDivider className="my-2" />
          <Link href="/signup" className="block focus:outline-none">
            <MenuRow
              label="Criar conta"
              sub="Não tem conta?"
              trailing={<IconChevronRight />}
              className="hover:bg-[rgba(255,255,255,0.05)]"
            />
          </Link>
        </ScenicPanel>
      </main>
    </>
  );
}
