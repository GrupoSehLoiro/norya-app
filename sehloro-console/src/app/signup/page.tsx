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
import type { AccountType } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface TypeConfig {
  type: AccountType;
  icon: string;
  label: string;
  tagline: string;
  formTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  docType: 'cpf' | 'cnpj';
  docLabel: string;
  docPlaceholder: string;
}

const TYPES: TypeConfig[] = [
  {
    type: 'streamer',
    icon: '👤',
    label: 'Pessoa física',
    tagline: 'Cadastro com CPF',
    formTitle: 'Criar conta (CPF)',
    nameLabel: 'Seu nome',
    namePlaceholder: 'ex: YoDa',
    docType: 'cpf',
    docLabel: 'CPF',
    docPlaceholder: '000.000.000-00',
  },
  {
    type: 'brand',
    icon: '🏢',
    label: 'Pessoa jurídica',
    tagline: 'Cadastro com CNPJ',
    formTitle: 'Criar conta (CNPJ)',
    nameLabel: 'Razão social / nome da empresa',
    namePlaceholder: 'ex: YoDaSnacks',
    docType: 'cnpj',
    docLabel: 'CNPJ',
    docPlaceholder: '00.000.000/0000-00',
  },
];

/** Máscara e validação de documento (espelha o validador do backend). */
function onlyDigits(v: string): string {
  return v.replace(/\D/g, '');
}

function maskDocument(value: string, type: 'cpf' | 'cnpj'): string {
  const d = onlyDigits(value).slice(0, type === 'cpf' ? 11 : 14);
  if (type === 'cpf') {
    if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
    return d;
  }
  if (d.length > 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length > 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  if (d.length > 5) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length > 2) return `${d.slice(0, 2)}.${d.slice(2)}`;
  return d;
}

function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split('').map(Number);
  for (let check = 9; check < 11; check++) {
    let sum = 0;
    for (let i = 0; i < check; i++) sum += digits[i]! * (check + 1 - i);
    let mod = (sum * 10) % 11;
    if (mod === 10) mod = 0;
    if (mod !== digits[check]) return false;
  }
  return true;
}

function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digits = cnpj.split('').map(Number);
  const calc = (weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + digits[i]! * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return (
    calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[12] &&
    calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[13]
  );
}

function isValidDocument(type: 'cpf' | 'cnpj', value: string): boolean {
  return type === 'cpf' ? isValidCpf(value) : isValidCnpj(value);
}

const Schema = z
  .object({
    displayName: z.string().min(1, 'informe um nome').max(120),
    document: z.string().min(1, 'informe o documento'),
    email: z.string().email('email inválido'),
    password: z.string().min(8, 'mínimo de 8 caracteres'),
    confirmPassword: z.string().min(1, 'confirme a senha'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'as senhas não conferem',
    path: ['confirmPassword'],
  });
type FormData = z.infer<typeof Schema>;

export default function SignupPage() {
  const [selected, setSelected] = useState<TypeConfig | null>(null);

  return (
    <>
      <Ambient />
      <main className="relative z-10 grid min-h-screen place-items-center p-6">
        {selected ? (
          <SignupForm config={selected} onBack={() => setSelected(null)} />
        ) : (
          <TypePicker onPick={setSelected} />
        )}
      </main>
    </>
  );
}

function TypePicker({ onPick }: { onPick: (t: TypeConfig) => void }) {
  return (
    <div className="w-full max-w-md space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink-800">Criar conta</h1>
        <p className="mt-1 text-sm text-ink-400">Como você vai usar a plataforma?</p>
      </div>

      <div className="space-y-3">
        {TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => onPick(t)}
            className={cn(
              'glass-card flex w-full items-center gap-4 text-left',
              'transition-all duration-200 ease-glass',
              'hover:-translate-y-px hover:border-accent-400/40',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60',
            )}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xl">
              {t.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink-800">{t.label}</span>
              <span className="block text-xs text-ink-400">{t.tagline}</span>
            </span>
            <span className="ml-auto text-ink-400">→</span>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-ink-400">
        Já tem conta?{' '}
        <Link href="/login" className="text-accent-400 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

function SignupForm({
  config,
  onBack,
}: {
  config: TypeConfig;
  onBack: () => void;
}) {
  const router = useRouter();
  const { register: registerAccount } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormData>();
  const [docError, setDocError] = useState<string | null>(null);

  async function onSubmit(values: FormData) {
    setServerError(null);
    setDocError(null);
    const parsed = Schema.safeParse(values);
    if (!parsed.success) {
      setServerError(parsed.error.errors[0]?.message ?? 'dados inválidos');
      return;
    }
    if (!isValidDocument(config.docType, parsed.data.document)) {
      setDocError(`${config.docLabel} inválido`);
      return;
    }
    setSubmitting(true);
    try {
      await registerAccount(
        parsed.data.email,
        parsed.data.password,
        parsed.data.displayName,
        config.type,
        onlyDigits(parsed.data.document),
      );
      router.push(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(
          err.status === 403 ? 'Esse email já está cadastrado.' : err.message,
        );
      } else {
        setServerError('Não foi possível criar a conta. Tente novamente.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="glass-card w-full max-w-sm space-y-4">
      <div className="mb-1">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-ink-400 hover:text-ink-700"
        >
          ← {config.icon} {config.label}
        </button>
      </div>
      <div className="mb-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-ink-800">
          {config.formTitle}
        </h1>
      </div>

      <Field label={config.nameLabel} error={errors.displayName?.message}>
        <Input
          type="text"
          autoComplete="organization"
          placeholder={config.namePlaceholder}
          {...register('displayName')}
        />
      </Field>

      <Field label={config.docLabel} error={docError ?? errors.document?.message}>
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={config.docPlaceholder}
          {...register('document', {
            onChange: (e) => {
              setValue('document', maskDocument(e.target.value, config.docType), {
                shouldValidate: false,
              });
            },
          })}
        />
      </Field>

      <Field label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="email" placeholder="voce@exemplo.com" {...register('email')} />
      </Field>

      <Field label="Senha" error={errors.password?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="mínimo 8 caracteres"
          {...register('password')}
        />
      </Field>

      <Field label="Confirmar senha" error={errors.confirmPassword?.message}>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="repita a senha"
          {...register('confirmPassword')}
        />
      </Field>

      {serverError && (
        <div className="rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
          {serverError}
        </div>
      )}

      <Button type="submit" className="w-full" loading={submitting} size="lg">
        Criar conta
      </Button>

      <p className="text-center text-xs text-ink-400">
        Já tem conta?{' '}
        <Link href="/login" className="text-accent-400 hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-err">{error}</p>}
    </div>
  );
}
