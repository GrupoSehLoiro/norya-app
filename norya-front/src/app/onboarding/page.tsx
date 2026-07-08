'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ambient } from '@/components/layout/ambient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stepper, type StepperStep } from '@/components/ui/stepper';
import { useAuth } from '@/hooks/use-auth';
import { api, ApiError, getToken } from '@/lib/api-client';
import {
  completeOnboarding,
  createCreator,
  fetchCreatorIntegrations,
  fetchCreators,
  fetchProfile,
  fetchTaxonomy,
  fetchUnlinkedIntegrations,
  linkIntegration,
  saveProfile,
  searchBrandCatalog,
  type IntegrationView,
  type ProfileView,
  type Taxonomy,
} from '@/lib/onboarding';

const STEPS: StepperStep[] = [
  { key: 'creator', label: 'Seu canal' },
  { key: 'connect', label: 'Conectar' },
  { key: 'profile', label: 'Perfil' },
  { key: 'brands', label: 'Marcas' },
  { key: 'review', label: 'Revisão' },
];

// Persistência do progresso — o OAuth é um redirect de página INTEIRA, então o
// wizard remonta ao voltar; sem isso o passo voltava pro início.
const STEP_KEY = 'onboarding:step';
const CREATOR_KEY = 'onboarding:creatorId';
const readLS = (k: string): string | null =>
  typeof window === 'undefined' ? null : window.localStorage.getItem(k);
const writeLS = (k: string, v: string | null) => {
  if (typeof window === 'undefined') return;
  if (v === null) window.localStorage.removeItem(k);
  else window.localStorage.setItem(k, v);
};

export default function OnboardingPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const qc = useQueryClient();
  const [step, setStepState] = useState(() => Number(readLS(STEP_KEY) ?? '0'));
  const [creatorId, setCreatorIdState] = useState<string | null>(() => readLS(CREATOR_KEY));

  const setStep = useCallback((n: number) => {
    setStepState(n);
    writeLS(STEP_KEY, String(n));
  }, []);
  const setCreatorId = useCallback((id: string | null) => {
    setCreatorIdState(id);
    writeLS(CREATOR_KEY, id);
  }, []);
  const finishOnboarding = useCallback(() => {
    writeLS(STEP_KEY, null);
    writeLS(CREATOR_KEY, null);
    router.push('/dashboard');
  }, [router]);

  // Gate de auth (página fora do (dashboard), sem AuthGuard próprio).
  useEffect(() => {
    if (ready && !user) router.replace('/login');
  }, [ready, user, router]);

  const creators = useQuery({ queryKey: ['creators'], queryFn: fetchCreators, enabled: !!user });

  // Reconcilia o creatorId persistido (localStorage) com os creators REAIS do
  // backend. Sem isso, um creatorId salvo que não existe mais no servidor
  // (DB recriado no restart do harness, ou de outro usuário no mesmo browser)
  // ficava preso no wizard → o link batia 404 "Creator não encontrado" e a
  // conta OAuth nunca vinculava. Auto-cura: adota o creator real ou volta ao
  // passo de criar.
  useEffect(() => {
    if (!creators.data) return; // aguarda o fetch
    const known = creators.data.some((c) => c.id === creatorId);
    if (creatorId && !known) {
      // Persistido mas inexistente/alheio → descarta e recomeça.
      setCreatorId(creators.data[0]?.id ?? null);
      setStep(creators.data[0] ? Math.max(step, 1) : 0);
      return;
    }
    if (!creatorId && creators.data[0]) {
      setCreatorId(creators.data[0].id);
      if (step < 1) setStep(1);
    }
  }, [creators.data, creatorId, step, setCreatorId, setStep]);

  if (!ready || !user) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <Ambient />
      <main className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink-800">Vamos configurar seu canal</h1>
          <p className="mt-1 text-sm text-ink-400">Leva menos de 2 minutos.</p>
        </div>

        <Stepper steps={STEPS} current={step} />

        <div className="glass-card space-y-5">
          {step === 0 && (
            <CreatorStep
              defaultName={user.username?.split('@')[0] ?? ''}
              existingName={creators.data?.[0]?.name}
              onDone={(id) => {
                setCreatorId(id);
                void qc.invalidateQueries({ queryKey: ['creators'] });
                setStep(1);
              }}
            />
          )}
          {step === 1 && creatorId && (
            <ConnectStep
              creatorId={creatorId}
              onBack={() => setStep(0)}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && creatorId && (
            <ProfileStep
              creatorId={creatorId}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && creatorId && (
            <BrandsStep
              creatorId={creatorId}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          )}
          {step === 4 && creatorId && (
            <ReviewStep
              creatorId={creatorId}
              onBack={() => setStep(3)}
              onDone={finishOnboarding}
            />
          )}
        </div>
      </main>
    </>
  );
}

// ── Passo 1: criar/nomear o creator ──────────────────────────────────────────
function CreatorStep({
  defaultName,
  existingName,
  onDone,
}: {
  defaultName: string;
  existingName?: string;
  onDone: (creatorId: string) => void;
}) {
  const [name, setName] = useState(existingName ?? defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function next() {
    if (name.trim().length === 0) {
      setError('Dê um nome ao canal.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Reusa creator existente se já houver; senão cria.
      const existing = await fetchCreators();
      const creator = existing[0] ?? (await createCreator(name.trim()));
      onDone(creator.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHeader title="Seu canal" subtitle="Como seu canal/streamer se chama?" />
      <FieldLabel>Nome do canal</FieldLabel>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: YoDa" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex justify-end">
        <Button onClick={next} loading={busy}>
          Continuar →
        </Button>
      </div>
    </>
  );
}

// ── Passo 2: conectar integração (OAuth) + vincular ───────────────────────────
function ConnectStep({
  creatorId,
  onBack,
  onNext,
}: {
  creatorId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Canais já tentados nesta sessão — evita re-tentar (e re-invalidar em loop)
  // os que o plano não comporta a cada refetch do `unlinked`.
  const attemptedRef = useRef<Set<string>>(new Set());

  const linked = useQuery({
    queryKey: ['creator-integrations', creatorId],
    queryFn: () => fetchCreatorIntegrations(creatorId),
  });
  const unlinked = useQuery({
    queryKey: ['unlinked-integrations'],
    queryFn: fetchUnlinkedIntegrations,
  });

  // Auto-vincula as contas recém-conectadas via OAuth — sem clique manual.
  // Resiliente: o limite de plano (PLAN_LIMIT) é ESPERADO no Free (1 integração
  // por creator), então NÃO é uma falha — vinculamos o que cabe e sinalizamos o
  // resto como "disponível no upgrade". Só é erro de verdade se NADA vincular
  // por um motivo diferente de plano. `linkIntegration` é idempotente.
  useEffect(() => {
    const pending = (unlinked.data ?? []).filter((it) => !attemptedRef.current.has(it.id));
    if (pending.length === 0 || busy) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      let linkedCount = 0;
      let planLimited = 0;
      let hardError: string | null = null;
      for (const it of pending) {
        attemptedRef.current.add(it.id);
        try {
          await linkIntegration(creatorId, it.id);
          linkedCount += 1;
        } catch (err) {
          const code =
            err instanceof ApiError
              ? (err.payload as { code?: string } | undefined)?.code
              : undefined;
          if (code === 'PLAN_LIMIT') {
            planLimited += 1;
          } else if (!hardError) {
            hardError = err instanceof ApiError ? err.message : 'Falha ao vincular a conta.';
          }
        }
      }
      await qc.invalidateQueries({ queryKey: ['creator-integrations', creatorId] });
      await qc.invalidateQueries({ queryKey: ['unlinked-integrations'] });
      if (cancelled) return;
      const totalLinked = (linked.data?.length ?? 0) + linkedCount;
      setError(totalLinked === 0 && hardError ? hardError : null);
      setNotice(
        planLimited > 0
          ? `Vinculamos ${planLimited === 1 ? '1 conta e outra fica' : `algumas contas e ${planLimited} ficam`} disponível(is) ao fazer upgrade do plano.`
          : null,
      );
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [unlinked.data, busy, creatorId, qc, linked.data]);

  function startOAuth(platform: 'twitch' | 'kick') {
    const tk = getToken();
    if (!tk) return;
    // redirect=/onboarding → o backend devolve pro wizard (não pra /integrations);
    // ao voltar, o efeito acima vincula a conta automaticamente.
    const ret = encodeURIComponent('/onboarding');
    window.location.href = `/api/v2/auth/${platform}/start?token=${encodeURIComponent(tk)}&redirect=${ret}`;
  }

  const hasLinked = (linked.data?.length ?? 0) > 0;

  return (
    <>
      <StepHeader
        title="Conectar canal"
        subtitle="Conecte ao menos uma plataforma — vinculamos automaticamente ao voltar."
      />

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => startOAuth('twitch')}>
          Conectar Twitch
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => startOAuth('kick')}>
          Conectar Kick
        </Button>
      </div>

      {busy && <p className="text-sm text-ink-400">vinculando conta…</p>}

      {notice && !busy && <p className="text-sm text-ink-400">{notice}</p>}

      {hasLinked ? (
        <div>
          <FieldLabel>Conectado a este canal</FieldLabel>
          <ul className="space-y-2">
            {linked.data!.map((it) => (
              <IntegrationRow key={it.id} it={it} trailing={<span className="text-xs text-ok">✓ vinculado</span>} />
            ))}
          </ul>
        </div>
      ) : (
        !busy && (
          <p className="text-sm text-ink-400">
            Nenhuma conta conectada ainda. Clique em uma plataforma acima para autorizar.
          </p>
        )
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <Button onClick={onNext} disabled={!hasLinked}>
          Continuar →
        </Button>
      </div>
    </>
  );
}

function IntegrationRow({ it, trailing }: { it: IntegrationView; trailing: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink-800">{it.displayName || it.name}</p>
        <p className="text-xs uppercase tracking-wide text-ink-400">{it.platform}</p>
      </div>
      {trailing}
    </li>
  );
}

// ── Passo 3: perfil do canal (taxonomia) ──────────────────────────────────────
function ProfileStep({
  creatorId,
  onBack,
  onNext,
}: {
  creatorId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const tax = useQuery<Taxonomy>({ queryKey: ['taxonomy'], queryFn: fetchTaxonomy });
  const profile = useQuery<ProfileView>({
    queryKey: ['profile', creatorId],
    queryFn: () => fetchProfile(creatorId),
  });

  const [category, setCategory] = useState('');
  const [niche, setNiche] = useState('');
  // Linha de rascunho do "adicionar interesse" (subcategoria + jogo/item).
  const [draftSub, setDraftSub] = useState('');
  const [draftItem, setDraftItem] = useState('');
  // Lista de interesses: pares { subcat, item }. Permite vários.
  const [interests, setInterests] = useState<{ subcat: string; item: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidrata do perfil salvo (tags = "subcat/item" ou "subcat").
  useEffect(() => {
    if (!profile.data) return;
    const p = profile.data;
    setCategory(p.category ?? '');
    setNiche(p.niche ?? '');
    setInterests(
      (p.tags ?? []).map((t) => {
        const [subcat, item] = t.split('/');
        return { subcat: subcat ?? '', item: item ?? '' };
      }).filter((i) => i.subcat),
    );
  }, [profile.data]);

  const subcats = useMemo(() => {
    const cat = tax.data?.categories.find((c) => c.value === category);
    return cat?.subcategories ?? [];
  }, [tax.data, category]);
  const draftItems = useMemo(
    () => subcats.find((s) => s.value === draftSub)?.items ?? [],
    [subcats, draftSub],
  );

  function labelOf(subcat: string, item: string): string {
    const sc = subcats.find((s) => s.value === subcat);
    const scLabel = sc?.label ?? subcat;
    if (!item) return scLabel;
    const it = sc?.items?.find((i) => i.value === item);
    return `${scLabel} · ${it?.label ?? item}`;
  }

  function addInterest() {
    if (!draftSub) return;
    setInterests((list) => {
      if (list.some((i) => i.subcat === draftSub && i.item === draftItem)) return list;
      return [...list, { subcat: draftSub, item: draftItem }];
    });
    setDraftSub('');
    setDraftItem('');
  }

  async function next() {
    if (!category) {
      setError('Escolha ao menos a categoria.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveProfile(creatorId, {
        niche,
        category,
        subcategory: interests[0]?.subcat ?? '',
        tags: interests.map((i) => (i.item ? `${i.subcat}/${i.item}` : i.subcat)),
      });
      await qc.invalidateQueries({ queryKey: ['profile', creatorId] });
      await qc.invalidateQueries({ queryKey: ['creators'] });
      onNext();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao salvar perfil.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHeader title="Perfil do canal" subtitle="Categoria e os jogos/assuntos que você cobre." />

      <Select
        label="Categoria"
        value={category}
        onChange={(v) => {
          setCategory(v);
          setDraftSub('');
          setDraftItem('');
        }}
        options={tax.data?.categories ?? []}
      />

      {/* Adicionar interesses (subcategoria + jogo) — vários */}
      <div className="rounded-lg border border-white/[0.06] p-3">
        <FieldLabel>Jogos / assuntos (adicione quantos quiser)</FieldLabel>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <Select label="Subcategoria" value={draftSub} onChange={(v) => { setDraftSub(v); setDraftItem(''); }} options={subcats} disabled={!subcats.length} />
          </div>
          {draftItems.length > 0 && (
            <div className="min-w-[140px] flex-1">
              <Select label="Específico" value={draftItem} onChange={setDraftItem} options={draftItems} />
            </div>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={addInterest} disabled={!draftSub}>
            + Adicionar
          </Button>
        </div>

        {interests.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {interests.map((i, idx) => (
              <span
                key={`${i.subcat}/${i.item}/${idx}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-sm text-ink-800"
              >
                {labelOf(i.subcat, i.item)}
                <button
                  type="button"
                  onClick={() => setInterests((list) => list.filter((_, k) => k !== idx))}
                  className="text-ink-400 hover:text-err"
                  aria-label="remover"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <FieldLabel>Nicho (livre)</FieldLabel>
        <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="ex: fps competitivo, foco em ranqueada" />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <Button onClick={next} loading={busy}>
          Continuar →
        </Button>
      </div>
    </>
  );
}

// ── Passo 4: marcas (busca no catálogo + multi-add) ───────────────────────────
interface BrandRow {
  id: string;
  name: string;
  aliases: string[];
}
function BrandsStep({
  creatorId,
  onBack,
  onNext,
}: {
  creatorId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  // Marcas são gravadas contra o primeiro canal vinculado (endpoint atual é
  // por canal; migração para creator é follow-up da Fase 2).
  const integrations = useQuery({
    queryKey: ['creator-integrations', creatorId],
    queryFn: () => fetchCreatorIntegrations(creatorId),
  });
  const channelId = integrations.data?.[0]?.id;

  const brands = useQuery({
    queryKey: ['brands', channelId],
    queryFn: () =>
      api.get<{ brands?: BrandRow[] } | BrandRow[]>(
        `/api/v2/social-listening/brands?channelId=${channelId}`,
      ),
    enabled: !!channelId,
  });
  const brandList: BrandRow[] = Array.isArray(brands.data)
    ? brands.data
    : (brands.data?.brands ?? []);
  const addedNames = new Set(brandList.map((b) => b.name.toLowerCase()));

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const results = useQuery({
    queryKey: ['brand-catalog', debounced],
    queryFn: () => searchBrandCatalog(debounced, 8),
    enabled: debounced.length > 0,
  });
  const suggestions = (results.data ?? []).filter(
    (b) => !addedNames.has(b.name.toLowerCase()),
  );

  async function add(name: string, aliases: string[]) {
    if (!channelId || name.trim().length === 0) return;
    if (addedNames.has(name.toLowerCase())) {
      setQuery('');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v2/social-listening/brands', {
        channelId,
        name: name.trim(),
        aliases,
      });
      setQuery('');
      await brands.refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao adicionar marca.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api/v2/social-listening/brands/${id}`);
      await brands.refetch();
    } catch {
      /* silencioso */
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (suggestions[0]) {
      void add(suggestions[0].name, suggestions[0].aliases);
    } else if (query.trim().length > 0) {
      // Sem match no catálogo → adiciona como marca custom.
      void add(query.trim(), []);
    }
  }

  return (
    <>
      <StepHeader
        title="Marcas associadas"
        subtitle="Adicione as marcas na qual você trabalha (opcional)"
      />

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar marca… (ex: Red Bull, Nubank, Nike)"
          disabled={!channelId}
        />
        {debounced.length > 0 && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-white/[0.1] bg-bg-1 p-1 shadow-elevated">
            {suggestions.map((b) => (
              <li key={b.slug}>
                <button
                  type="button"
                  onClick={() => add(b.name, b.aliases)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-ink-800 hover:bg-white/[0.06]"
                >
                  <span>{b.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-ink-400">
                    {b.sector}
                    {b.country === 'br' ? ' · BR' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {debounced.length > 0 && !results.isLoading && suggestions.length === 0 && (
          <p className="mt-1 text-xs text-ink-400">
            Sem resultado no catálogo. Enter adiciona “{query.trim()}” como marca custom.
          </p>
        )}
      </div>

      {brandList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {brandList.map((b) => (
            <span
              key={b.id}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-3 py-1 text-sm text-ink-800"
            >
              {b.name}
              <button
                type="button"
                onClick={() => remove(b.id)}
                className="text-ink-400 hover:text-err"
                aria-label={`remover ${b.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {busy && <p className="text-xs text-ink-400">adicionando…</p>}
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <Button onClick={onNext}>{brandList.length > 0 ? 'Continuar →' : 'Pular →'}</Button>
      </div>
    </>
  );
}

// ── Passo 5: revisão + concluir ───────────────────────────────────────────────
function ReviewStep({
  creatorId,
  onBack,
  onDone,
}: {
  creatorId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const creators = useQuery({ queryKey: ['creators'], queryFn: fetchCreators });
  const integrations = useQuery({
    queryKey: ['creator-integrations', creatorId],
    queryFn: () => fetchCreatorIntegrations(creatorId),
  });
  const profile = useQuery<ProfileView>({
    queryKey: ['profile', creatorId],
    queryFn: () => fetchProfile(creatorId),
  });
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const creator = creators.data?.find((c) => c.id === creatorId);

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding();
      // Atualiza o /me (onboardingCompleted=true) ANTES de ir pro dashboard,
      // senão o OnboardingGuard relê o cache antigo e devolve pro onboarding.
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.refetchQueries({ queryKey: ['me'] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHeader title="Tudo pronto?" subtitle="Revise antes de concluir." />
      <dl className="space-y-3 text-sm">
        <Row label="Canal" value={creator?.name ?? '—'} />
        <Row
          label="Integrações"
          value={(integrations.data ?? []).map((i) => i.platform).join(', ') || '—'}
        />
        <Row label="Categoria" value={profile.data?.category || '—'} />
        <Row
          label="Jogos / assuntos"
          value={
            (profile.data?.tags ?? [])
              .map((t) => t.split('/').pop() || t)
              .join(', ') || '—'
          }
        />
        <Row label="Nicho" value={profile.data?.niche || '—'} />
      </dl>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          ← Voltar
        </Button>
        <Button onClick={finish} loading={busy} size="lg">
          Concluir e ir ao dashboard
        </Button>
      </div>
    </>
  );
}

// ── helpers de UI ─────────────────────────────────────────────────────────────
function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink-800">{title}</h2>
      <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>
    </div>
  );
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
      {children}
    </label>
  );
}
function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-white/[0.05] pb-2">
      <dt className="text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20 disabled:opacity-50"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-bg-1 text-ink-800">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
