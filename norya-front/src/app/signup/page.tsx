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
import {
  IconBuilding,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconUser,
} from '@/components/ui/icons';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api-client';
import type { AccountType } from '@/lib/auth';

interface TypeConfig {
  type: AccountType;
  icon: React.ReactNode;
  label: string;
  tagline: string;
  nameLabel: string;
  namePlaceholder: string;
  docType: 'cpf' | 'cnpj';
  docLabel: string;
  docPlaceholder: string;
}

const TYPES: TypeConfig[] = [
  {
    type: 'streamer',
    icon: <IconUser size={18} />,
    label: 'Pessoa física',
    tagline: 'Cadastro com CPF',
    nameLabel: 'Seu nome',
    namePlaceholder: 'ex: YoDa',
    docType: 'cpf',
    docLabel: 'CPF',
    docPlaceholder: '000.000.000-00',
  },
  {
    type: 'brand',
    icon: <IconBuilding size={18} />,
    label: 'Pessoa jurídica',
    tagline: 'Cadastro com CNPJ',
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
      <Scenic />
      <main className="relative z-10 grid min-h-screen place-items-center p-6">
        <ScenicPanel className="w-full max-w-md">
          <div className="px-4 pb-3 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d7fe01]">
              Norya
            </p>
            <h1 className="mt-1.5 text-xl font-bold tracking-tight text-[#eef1f5]">Criar conta</h1>
            <p className="mt-0.5 text-sm text-[rgba(255,255,255,0.45)]">
              Como você vai usar a plataforma?
            </p>
          </div>

          {/* Accordion no padrão da referência: row ativa vira pill escuro com
              chevron pra cima e o formulário expande logo abaixo. */}
          <div className="space-y-1">
            {TYPES.map((t) => {
              const open = selected?.type === t.type;
              return (
                <div key={t.type}>
                  <MenuRow
                    icon={t.icon}
                    label={t.label}
                    sub={t.tagline}
                    active={open}
                    onClick={() => setSelected(open ? null : t)}
                    trailing={open ? <IconChevronUp /> : <IconChevronDown />}
                  />
                  {open && <SignupForm config={t} />}
                </div>
              );
            })}
          </div>

          <SDivider className="my-2" />
          <Link href="/login" className="block focus:outline-none">
            <MenuRow
              label="Entrar"
              sub="Já tem conta?"
              trailing={<IconChevronRight />}
              className="hover:bg-[rgba(255,255,255,0.05)]"
            />
          </Link>
        </ScenicPanel>
      </main>
    </>
  );
}

function SignupForm({ config }: { config: TypeConfig }) {
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
      // Conta criada e logada — segue direto pro onboarding.
      router.push('/onboarding');
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
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 px-4 pb-3 pt-4"
    >
      <Field label={config.nameLabel} error={errors.displayName?.message}>
        <SInput
          type="text"
          autoComplete="organization"
          placeholder={config.namePlaceholder}
          {...register('displayName')}
        />
      </Field>

      <Field label={config.docLabel} error={docError ?? errors.document?.message}>
        <SInput
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
        <SInput type="email" autoComplete="email" placeholder="voce@exemplo.com" {...register('email')} />
      </Field>

      <Field label="Senha" error={errors.password?.message}>
        <SInput
          type="password"
          autoComplete="new-password"
          placeholder="mínimo 8 caracteres"
          {...register('password')}
        />
      </Field>

      <Field label="Confirmar senha" error={errors.confirmPassword?.message}>
        <SInput
          type="password"
          autoComplete="new-password"
          placeholder="repita a senha"
          {...register('confirmPassword')}
        />
      </Field>

      {serverError && <SError>{serverError}</SError>}

      <SButton type="submit" className="w-full" loading={submitting}>
        Criar conta
      </SButton>
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
      <SLabel>{label}</SLabel>
      {children}
      {error && <p className="mt-1 text-xs text-[#fca5a5]">{error}</p>}
    </div>
  );
}
