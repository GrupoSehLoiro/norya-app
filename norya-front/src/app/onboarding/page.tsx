'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MenuRow,
  Scenic,
  ScenicPanel,
  SButton,
  SError,
  SInput,
  SLabel,
} from '@/components/auth/scenic';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconPlus,
  IconX,
} from '@/components/ui/icons';
import { cn } from '@/lib/utils';
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

const STEPS: { key: string; label: string }[] = [
  { key: 'creator', label: 'Seu perfil' },
  { key: 'connect', label: 'Seus canais' },
  { key: 'profile', label: 'Nicho' },
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
      <>
        <Scenic />
        <div className="relative z-10 grid h-screen place-items-center">
          <div className="size-6 animate-spin rounded-full border-2 border-[#d7fe01] border-t-transparent" />
        </div>
      </>
    );
  }

  // Conteúdo do passo ativo — renderizado logo abaixo da row correspondente,
  // como os sub-itens expandidos do menu de referência.
  function stepContent(i: number): React.ReactNode {
    if (i === 0) {
      return (
        <CreatorStep
          defaultName={user!.username?.split('@')[0] ?? ''}
          existingName={creators.data?.[0]?.name}
          onDone={(id) => {
            setCreatorId(id);
            void qc.invalidateQueries({ queryKey: ['creators'] });
            setStep(1);
          }}
        />
      );
    }
    if (!creatorId) return null;
    if (i === 1) {
      return (
        <ConnectStep creatorId={creatorId} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      );
    }
    if (i === 2) {
      return (
        <ProfileStep creatorId={creatorId} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      );
    }
    if (i === 3) {
      return (
        <BrandsStep creatorId={creatorId} onBack={() => setStep(2)} onNext={() => setStep(4)} />
      );
    }
    return (
      <ReviewStep creatorId={creatorId} onBack={() => setStep(3)} onDone={finishOnboarding} />
    );
  }

  return (
    <>
      <Scenic />
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center p-6">
        <ScenicPanel>
          <div className="px-4 pb-3 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d7fe01]">
              Norya
            </p>
            <h1 className="mt-1.5 text-xl font-bold tracking-tight text-[#eef1f5]">
              Vamos configurar seu perfil
            </h1>
            <p className="mt-0.5 text-sm text-[rgba(255,255,255,0.45)]">Leva menos de 2 minutos.</p>
          </div>

          <div className="space-y-1">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div key={s.key}>
                  <MenuRow
                    icon={<StepBadge n={i} done={done} active={active} />}
                    label={
                      active ? (
                        s.label
                      ) : (
                        <span className={done ? 'text-[rgba(255,255,255,0.75)]' : 'text-[rgba(255,255,255,0.45)]'}>
                          {s.label}
                        </span>
                      )
                    }
                    active={active}
                    trailing={active ? <IconChevronUp /> : undefined}
                  />
                  {active && <div className="space-y-4 px-4 pb-3 pt-4">{stepContent(i)}</div>}
                </div>
              );
            })}
          </div>
        </ScenicPanel>
      </main>
    </>
  );
}

/** Bolinha do passo: número → check quando concluído; escura sobre o pill lime. */
function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span
      className={cn(
        'grid size-6 place-items-center rounded-full text-[11px] font-semibold',
        active
          ? 'bg-[rgba(7,9,12,0.9)] text-[#d7fe01]'
          : done
            ? 'bg-[rgba(215,254,1,0.16)] text-[#d7fe01]'
            : 'border border-[rgba(255,255,255,0.22)] text-[rgba(255,255,255,0.5)]',
      )}
    >
      {done ? <IconCheck size={11} /> : n + 1}
    </span>
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
      setError('Dê um nome ao seu perfil.');
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
      <StepHeader subtitle="Seu perfil de criador. Os canais que você conectar no próximo passo ficam ligados a ele." />
      <FieldLabel>Nome do criador</FieldLabel>
      <SInput value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: YoDa" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex justify-end">
        <SButton onClick={next} loading={busy}>
          Continuar <IconChevronRight size={13} />
        </SButton>
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
          ? `Conectamos ${planLimited === 1 ? '1 canal e outro fica' : `alguns canais e ${planLimited} ficam`} disponível(is) ao fazer upgrade do plano.`
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
      <StepHeader subtitle="Conecte seus canais: Twitch, Kick. Vinculamos ao seu perfil automaticamente ao voltar." />

      <div className="flex gap-2">
        <SButton variant="secondary" className="flex-1" onClick={() => startOAuth('twitch')}>
          Conectar Twitch
        </SButton>
        <SButton variant="secondary" className="flex-1" onClick={() => startOAuth('kick')}>
          Conectar Kick
        </SButton>
      </div>

      {busy && <p className="text-sm text-[rgba(255,255,255,0.45)]">conectando canal…</p>}

      {notice && !busy && <p className="text-sm text-[rgba(255,255,255,0.45)]">{notice}</p>}

      {hasLinked ? (
        <div>
          <FieldLabel>Canais conectados</FieldLabel>
          <ul className="space-y-2">
            {linked.data!.map((it) => (
              <IntegrationRow
                key={it.id}
                it={it}
                trailing={
                  <span className="inline-flex items-center gap-1 text-xs text-[#6ee7b7]">
                    <IconCheck size={12} /> vinculado
                  </span>
                }
              />
            ))}
          </ul>
        </div>
      ) : (
        !busy && (
          <p className="text-sm text-[rgba(255,255,255,0.45)]">
            Nenhum canal conectado ainda. Escolha uma plataforma acima para autorizar.
          </p>
        )
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <SButton variant="ghost" onClick={onBack}>
          <IconChevronLeft size={13} /> Voltar
        </SButton>
        <SButton onClick={onNext} disabled={!hasLinked}>
          Continuar <IconChevronRight size={13} />
        </SButton>
      </div>
    </>
  );
}

function IntegrationRow({ it, trailing }: { it: IntegrationView; trailing: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-[rgba(255,255,255,0.08)] p-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-[#eef1f5]">{it.displayName || it.name}</p>
        <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.45)]">{it.platform}</p>
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
      <StepHeader subtitle="Categoria e os jogos/assuntos que você cobre." />

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
      <div className="rounded-lg border border-[rgba(255,255,255,0.08)] p-3">
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
          <SButton type="button" size="sm" variant="secondary" onClick={addInterest} disabled={!draftSub}>
            <IconPlus size={12} /> Adicionar
          </SButton>
        </div>

        {interests.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {interests.map((i, idx) => (
              <span
                key={`${i.subcat}/${i.item}/${idx}`}
                className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-3 py-1 text-sm text-[#eef1f5]"
              >
                {labelOf(i.subcat, i.item)}
                <button
                  type="button"
                  onClick={() => setInterests((list) => list.filter((_, k) => k !== idx))}
                  className="text-[rgba(255,255,255,0.45)] hover:text-[#f87171]"
                  aria-label="remover"
                >
                  <IconX />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <FieldLabel>Nicho (livre)</FieldLabel>
        <SInput value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="ex: fps competitivo, foco em ranqueada" />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <SButton variant="ghost" onClick={onBack}>
          <IconChevronLeft size={13} /> Voltar
        </SButton>
        <SButton onClick={next} loading={busy}>
          Continuar <IconChevronRight size={13} />
        </SButton>
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
  // A allowlist é INDIVIDUAL do criador (creatorId), não do canal: escopar por
  // canal vazava marcas entre usuários que reaproveitam a mesma conta de
  // plataforma. O backend carimba/filtra por creatorId.
  const brands = useQuery({
    queryKey: ['brands', 'creator', creatorId],
    queryFn: () =>
      api.get<{ brands?: BrandRow[] } | BrandRow[]>(
        `/api/v2/social-listening/brands?creatorId=${creatorId}`,
      ),
    enabled: !!creatorId,
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
    if (!creatorId || name.trim().length === 0) return;
    if (addedNames.has(name.toLowerCase())) {
      setQuery('');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v2/social-listening/brands', {
        creatorId,
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
      <StepHeader subtitle="Marcas e termos que você quer acompanhar no chat: patrocinadores, seu nick, uma hashtag. Opcional, dá pra ajustar depois." />

      <div className="relative">
        <SInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Buscar marca ou digitar um termo… (ex: Red Bull, seu nick, #campanha)"
          disabled={!creatorId}
        />
        {debounced.length > 0 && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-[rgba(255,255,255,0.12)] bg-[#232b35] p-1 shadow-elevated">
            {suggestions.map((b) => (
              <li key={b.slug}>
                <button
                  type="button"
                  onClick={() => add(b.name, b.aliases)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-[#eef1f5] hover:bg-[rgba(255,255,255,0.07)]"
                >
                  <span>{b.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-[rgba(255,255,255,0.45)]">
                    {b.sector}
                    {b.country === 'br' ? ' · BR' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {debounced.length > 0 && !results.isLoading && suggestions.length === 0 && (
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.45)]">
            Sem resultado no catálogo. Enter adiciona “{query.trim()}” como marca custom.
          </p>
        )}
      </div>

      {brandList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {brandList.map((b) => (
            <span
              key={b.id}
              className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-3 py-1 text-sm text-[#eef1f5]"
            >
              {b.name}
              <button
                type="button"
                onClick={() => remove(b.id)}
                className="text-[rgba(255,255,255,0.45)] hover:text-[#f87171]"
                aria-label={`remover ${b.name}`}
              >
                <IconX />
              </button>
            </span>
          ))}
        </div>
      )}

      {busy && <p className="text-xs text-[rgba(255,255,255,0.45)]">adicionando…</p>}
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex justify-between">
        <SButton variant="ghost" onClick={onBack}>
          <IconChevronLeft size={13} /> Voltar
        </SButton>
        <SButton onClick={onNext}>
          {brandList.length > 0 ? 'Continuar' : 'Pular'} <IconChevronRight size={13} />
        </SButton>
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
      <StepHeader subtitle="Revise antes de concluir." />
      <dl className="space-y-3 text-sm">
        <Row label="Perfil" value={creator?.name ?? '—'} />
        <Row
          label="Canais"
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
        <SButton variant="ghost" onClick={onBack}>
          <IconChevronLeft size={13} /> Voltar
        </SButton>
        <SButton onClick={finish} loading={busy}>
          Concluir e ir ao dashboard
        </SButton>
      </div>
    </>
  );
}

// ── helpers de UI ─────────────────────────────────────────────────────────────
// O título do passo agora é a própria row do accordion — aqui só a instrução.
function StepHeader({ subtitle }: { subtitle: string }) {
  return <p className="text-sm text-[rgba(255,255,255,0.45)]">{subtitle}</p>;
}
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <SLabel>{children}</SLabel>;
}
function ErrorBox({ children }: { children: React.ReactNode }) {
  return <SError>{children}</SError>;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-[rgba(255,255,255,0.07)] pb-2">
      <dt className="text-[rgba(255,255,255,0.45)]">{label}</dt>
      <dd className="font-medium text-[#eef1f5]">{value}</dd>
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
        className="h-11 w-full rounded-xl border border-[rgba(255,255,255,0.09)] bg-[rgba(13,18,24,0.45)] px-3 text-sm text-[#eef1f5] transition-colors focus:border-[rgba(255,255,255,0.28)] focus:outline-none disabled:opacity-50"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#232b35] text-[#eef1f5]">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
