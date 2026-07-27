'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { IconCheck, IconPlus, IconX } from '@/components/ui/icons';
import { useMe, canManage } from '@/hooks/use-me';
import { updateMe, type UpdateMePayload } from '@/lib/auth';
import {
  fetchCreators,
  fetchProfile,
  fetchTaxonomy,
  saveProfile,
  type ProfileView,
  type Taxonomy,
} from '@/lib/onboarding';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const me = useMe();
  const manage = canManage(me.data?.wsRole);

  return (
    <div className="flex flex-col gap-10 pb-24">
      <PageHeader
        eyebrow="Sua conta"
        title="Configurações"
        description="Ajuste como você aparece na Norya e, o mais importante, a taxonomia do seu canal: a categoria e os jogos que ensinam a IA a ler o seu chat com contexto."
        info="A taxonomia é o que dá contexto às análises. Quanto mais preciso o nicho e a categoria, mais afiadas ficam as leituras de sentimento, pautas e marcas que a Norya gera a cada janela de chat."
      />

      <AccountSection />
      <TaxonomySection canManage={manage} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Conta — nome de exibição (editável) e email (só leitura).
 * ───────────────────────────────────────────────────────────────────────── */
function AccountSection() {
  const qc = useQueryClient();
  const me = useMe();

  const savedName = me.data?.user.displayName ?? '';
  const [displayName, setDisplayName] = useState('');
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidrata o campo quando o /me chega (ou muda).
  useEffect(() => {
    setDisplayName(savedName);
  }, [savedName]);

  const dirty = displayName.trim() !== savedName.trim() && displayName.trim().length > 0;

  const save = useMutation({
    mutationFn: (payload: UpdateMePayload) => updateMe(payload),
    onSuccess: (data) => {
      qc.setQueryData(['me'], data);
      void qc.invalidateQueries({ queryKey: ['me'] });
      setError(null);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });

  return (
    <Card>
      <CardHeader
        eyebrow="Conta"
        title="Seu perfil"
        description="Como você é identificado dentro da plataforma."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Nome de exibição"
          hint="Aparece no seu perfil e nos relatórios que você exporta."
        >
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="ex: YoDa"
            maxLength={120}
          />
        </Field>

        <Field label="Email" hint="Usado para login. Fale com o suporte para alterar.">
          <Input value={me.data?.user.email ?? ''} disabled readOnly />
        </Field>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {ok && (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <IconCheck size={14} /> Alterações salvas
          </span>
        )}
        <Button
          onClick={() => save.mutate({ displayName: displayName.trim() })}
          disabled={!dirty}
          loading={save.isPending}
        >
          Salvar alterações
        </Button>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Taxonomia — perfil do creator (categoria, jogos/assuntos, nicho).
 * É o que dá contexto à IA. Editável por manager+; só leitura para os demais.
 * ───────────────────────────────────────────────────────────────────────── */
interface Interest {
  subcat: string;
  item: string;
}

function TaxonomySection({ canManage: manage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const creators = useQuery({ queryKey: ['creators'], queryFn: fetchCreators });
  const [creatorId, setCreatorId] = useState<string | null>(null);

  // Adota o primeiro creator assim que a lista chega (ou se o atual sumir).
  useEffect(() => {
    const list = creators.data;
    if (!list || list.length === 0) return;
    if (!creatorId || !list.some((c) => c.id === creatorId)) {
      setCreatorId(list[0]!.id);
    }
  }, [creators.data, creatorId]);

  if (creators.isLoading) {
    return (
      <Card>
        <CardHeader eyebrow="Contexto da IA" title="Taxonomia do canal" />
        <p className="text-sm text-ink-400">carregando…</p>
      </Card>
    );
  }

  if ((creators.data?.length ?? 0) === 0) {
    return (
      <EmptyState
        title="Nenhum perfil de canal ainda"
        description="A taxonomia mora no perfil do seu canal. Conecte um canal para começar a configurar categoria e jogos."
      />
    );
  }

  return (
    <Card>
      <CardHeader
        eyebrow="Contexto da IA"
        title="Taxonomia do canal"
        description="Categoria e jogos/assuntos. É o vocabulário que a Norya usa para interpretar cada janela do seu chat."
        actions={
          (creators.data?.length ?? 0) > 1 && creatorId ? (
            <select
              value={creatorId}
              onChange={(e) => setCreatorId(e.target.value)}
              className="h-9 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none"
              aria-label="Escolher perfil de canal"
            >
              {creators.data!.map((c) => (
                <option key={c.id} value={c.id} className="bg-bg-1">
                  {c.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {creatorId && (
        <TaxonomyEditor
          key={creatorId}
          creatorId={creatorId}
          canManage={manage}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['creators'] });
          }}
        />
      )}
    </Card>
  );
}

function TaxonomyEditor({
  creatorId,
  canManage: manage,
  onSaved,
}: {
  creatorId: string;
  canManage: boolean;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const tax = useQuery<Taxonomy>({ queryKey: ['taxonomy'], queryFn: fetchTaxonomy });
  const profile = useQuery<ProfileView>({
    queryKey: ['profile', creatorId],
    queryFn: () => fetchProfile(creatorId),
  });

  const [category, setCategory] = useState('');
  const [niche, setNiche] = useState('');
  const [interests, setInterests] = useState<Interest[]>([]);
  const [draftSub, setDraftSub] = useState('');
  const [draftItem, setDraftItem] = useState('');
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snapshot serializado do que veio do servidor — base do "dirty".
  const [baseline, setBaseline] = useState('');

  // Hidrata do perfil salvo.
  useEffect(() => {
    if (!profile.data) return;
    const p = profile.data;
    const parsedInterests = (p.tags ?? [])
      .map((t) => {
        const [subcat, item] = t.split('/');
        return { subcat: subcat ?? '', item: item ?? '' };
      })
      .filter((i) => i.subcat);
    setCategory(p.category ?? '');
    setNiche(p.niche ?? '');
    setInterests(parsedInterests);
    setBaseline(serialize(p.category ?? '', p.niche ?? '', parsedInterests));
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

  const current = serialize(category, niche, interests);
  const dirty = manage && baseline !== '' && current !== baseline;

  const save = useMutation({
    mutationFn: () =>
      saveProfile(creatorId, {
        category,
        subcategory: interests[0]?.subcat ?? '',
        niche: niche.trim(),
        tags: interests.map((i) => (i.item ? `${i.subcat}/${i.item}` : i.subcat)),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['profile', creatorId] });
      onSaved();
      setError(null);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });

  if (tax.isLoading || profile.isLoading) {
    return <p className="text-sm text-ink-400">carregando…</p>;
  }

  // Só leitura para papéis sem gestão.
  if (!manage) {
    return (
      <div className="space-y-4">
        <ReadOnlyRow label="Categoria" value={labelForCategory(tax.data, category) || '—'} />
        <ReadOnlyRow
          label="Jogos / assuntos"
          value={interests.map((i) => labelOf(i.subcat, i.item)).join(', ') || '—'}
        />
        <ReadOnlyRow label="Nicho" value={niche || '—'} />
        <p className="pt-1 text-xs text-ink-400">
          Só quem gerencia o workspace pode editar a taxonomia.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Categoria + Nicho */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Categoria" hint="O grande guarda-chuva do seu conteúdo.">
          <SelectField
            value={category}
            onChange={(v) => {
              setCategory(v);
              setDraftSub('');
              setDraftItem('');
            }}
            options={tax.data?.categories ?? []}
          />
        </Field>
        <Field label="Nicho" hint="Em uma frase, o que te diferencia.">
          <Input
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="ex: FPS competitivo, foco em ranqueada"
            maxLength={120}
          />
        </Field>
      </div>

      {/* Jogos / assuntos */}
      <Field
        label="Jogos / assuntos"
        hint="Adicione quantos quiser. Cada um afina o vocabulário da análise."
      >
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[150px] flex-1">
              <MicroLabel>Subcategoria</MicroLabel>
              <SelectField
                value={draftSub}
                onChange={(v) => {
                  setDraftSub(v);
                  setDraftItem('');
                }}
                options={subcats}
                disabled={!subcats.length}
              />
            </div>
            {draftItems.length > 0 && (
              <div className="min-w-[150px] flex-1">
                <MicroLabel>Específico</MicroLabel>
                <SelectField value={draftItem} onChange={setDraftItem} options={draftItems} />
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={addInterest}
              disabled={!draftSub}
            >
              <IconPlus size={13} /> Adicionar
            </Button>
          </div>

          {interests.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {interests.map((i, idx) => (
                <span
                  key={`${i.subcat}/${i.item}/${idx}`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-sm text-ink-800"
                >
                  {labelOf(i.subcat, i.item)}
                  <button
                    type="button"
                    onClick={() => setInterests((list) => list.filter((_, k) => k !== idx))}
                    className="text-ink-400 transition-colors hover:text-err"
                    aria-label={`remover ${labelOf(i.subcat, i.item)}`}
                  >
                    <IconX size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-400">
              {subcats.length
                ? 'Nenhum ainda. Escolha uma subcategoria e adicione.'
                : 'Escolha uma categoria acima para liberar as subcategorias.'}
            </p>
          )}
        </div>
      </Field>

      {error && (
        <p className="rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
        {ok && (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <IconCheck size={14} /> Taxonomia salva
          </span>
        )}
        <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
          Salvar taxonomia
        </Button>
      </div>
    </div>
  );
}

/* ── helpers de UI ───────────────────────────────────────────────────────── */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-ink-400">{hint}</p>}
    </label>
  );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
      {children}
    </span>
  );
}

function SelectField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-10 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800',
        'transition-colors focus:border-accent-400/60 focus:bg-white/[0.06] focus:outline-none',
        'focus:ring-2 focus:ring-accent-400/20 disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <option value="" className="bg-bg-1">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-bg-1 text-ink-800">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/[0.06] pb-3 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <MicroLabel>{label}</MicroLabel>
      <span className="text-sm text-ink-800 sm:text-right">{value}</span>
    </div>
  );
}

/* ── helpers de dados ────────────────────────────────────────────────────── */
function serialize(category: string, niche: string, interests: Interest[]): string {
  return JSON.stringify({
    category,
    niche: niche.trim(),
    interests: interests.map((i) => `${i.subcat}/${i.item}`),
  });
}

function labelForCategory(tax: Taxonomy | undefined, value: string): string {
  return tax?.categories.find((c) => c.value === value)?.label ?? value;
}
