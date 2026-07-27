'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminGate } from '@/components/auth/admin-gate';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { api, ApiError } from '@/lib/api-client';
import { fetchTaxonomy } from '@/lib/onboarding';
import { fetchChannels } from '@/lib/queries';
import {
  AI_CONTEXT_PROMPT_MAX,
  AI_CONTEXT_PROMPTS_PER_NODE,
  deleteAiContext,
  fetchAiContexts,
  previewAiContext,
  upsertAiContext,
  type AiContextScope,
  type AiTrainingContext,
} from '@/lib/ai-training';
import { cn } from '@/lib/utils';

/** Nó em edição no modal. */
interface EditTarget {
  scope: AiContextScope;
  key: string;
  label: string;
}

const ctxKey = (scope: AiContextScope, key: string) => `${scope}:${key}`;

export default function AiTrainingPage() {
  return (
    <AdminGate>
      <AiTrainingInner />
    </AdminGate>
  );
}

function AiTrainingInner() {
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [newBrand, setNewBrand] = useState('');

  const contexts = useQuery({ queryKey: ['ai-training'], queryFn: fetchAiContexts });
  const taxonomy = useQuery({ queryKey: ['onboarding-taxonomy'], queryFn: fetchTaxonomy });

  const byKey = useMemo(() => {
    const m = new Map<string, AiTrainingContext>();
    for (const c of contexts.data ?? []) m.set(ctxKey(c.scope, c.key), c);
    return m;
  }, [contexts.data]);

  const globalDoc = byKey.get(ctxKey('global', ''));
  const brandDocs = (contexts.data ?? []).filter((c) => c.scope === 'brand');

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Admin"
        title="Treinamento IA"
        description="Ensine o contexto de cada categoria, game e marca. A IA usa isso em todas as análises."
        info="Cada nó da taxonomia (categoria → subcategoria → game) e cada marca pode ter um prompt de contexto. Quando um canal tem aquele perfil, o prompt entra automaticamente nas análises de IA daquele canal."
      />

      {/* Prompt global */}
      <Card className="outline outline-1 -outline-offset-1 outline-pal-mint-line">
        <CardHeader
          eyebrow="Base"
          title="Prompt global"
          description="Contexto que vale para TODOS os canais, sempre."
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing({ scope: 'global', key: '', label: 'Prompt global' })}
            >
              {globalDoc ? 'Editar' : '+ Criar'}
            </Button>
          }
        />
        {globalDoc ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                {globalDoc.prompts[0]}
              </p>
              {globalDoc.prompts.length > 1 && (
                <p className="mt-1 text-xs text-ink-400">+{globalDoc.prompts.length - 1} texto(s)</p>
              )}
            </div>
            <Badge tone={globalDoc.enabled ? 'positive' : 'neutral'}>
              {globalDoc.enabled ? 'ativo' : 'desativado'}
            </Badge>
          </div>
        ) : (
          <p className="text-sm text-ink-400">Nenhum prompt global ainda.</p>
        )}
      </Card>

      {/* Árvore da taxonomia */}
      <Card>
        <CardHeader
          eyebrow="Taxonomia"
          title="Categorias, subcategorias e games"
          description="Clique num item para escrever ou editar o prompt daquele contexto."
        />
        {taxonomy.isLoading ? (
          <p className="text-sm text-ink-400">carregando taxonomia…</p>
        ) : taxonomy.isError ? (
          <p className="text-sm text-err">Não foi possível carregar a taxonomia.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {taxonomy.data!.categories
              .filter((cat) => cat.value !== 'other')
              .map((cat) => (
                <CategoryAccordion
                  key={cat.value}
                  cat={cat}
                  byKey={byKey}
                  onEdit={setEditing}
                />
              ))}
          </div>
        )}
      </Card>

      {/* Marcas */}
      <Card>
        <CardHeader
          eyebrow="Marcas"
          title="Prompts por marca"
          description="O prompt entra quando a marca está no monitoramento do canal."
        />
        <form
          className="mb-4 flex max-w-md gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newBrand.trim().toLowerCase();
            if (name.length < 2) return;
            setEditing({ scope: 'brand', key: name, label: `Marca: ${name}` });
            setNewBrand('');
          }}
        >
          <Input
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            placeholder="ex: redbull"
            aria-label="Nova marca"
          />
          <Button type="submit" variant="secondary" size="sm">+ Adicionar</Button>
        </form>
        {brandDocs.length === 0 ? (
          <p className="text-sm text-ink-400">Nenhuma marca com prompt ainda.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {brandDocs.map((b) => (
              <li key={b.key}>
                <NodeChip
                  label={b.key}
                  doc={b}
                  onClick={() => setEditing({ scope: 'brand', key: b.key, label: `Marca: ${b.key}` })}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Prévia por canal */}
      <PreviewCard />

      {editing && (
        <EditContextModal
          target={editing}
          existing={byKey.get(ctxKey(editing.scope, editing.key)) ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── Árvore ────────────────────────────────────────────────────────────────

function CategoryAccordion({
  cat, byKey, onEdit,
}: {
  cat: { value: string; label: string; subcategories: { value: string; label: string; items?: { value: string; label: string }[] }[] };
  byKey: Map<string, AiTrainingContext>;
  onEdit: (t: EditTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const catDoc = byKey.get(ctxKey('category', cat.value));

  // Quantos prompts existem dentro desta categoria (p/ badge no accordion)
  const childCount = cat.subcategories.reduce((acc, sub) => {
    let n = byKey.has(ctxKey('subcategory', sub.value)) ? 1 : 0;
    for (const it of sub.items ?? []) {
      if (byKey.has(ctxKey('item', `${sub.value}/${it.value}`))) n += 1;
    }
    return acc + n;
  }, (catDoc ? 1 : 0));

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="flex items-center gap-2.5">
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden
            className={cn('text-ink-400 transition-transform', open ? 'rotate-90' : '')}
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-semibold text-ink-800">{cat.label}</span>
        </span>
        {childCount > 0 && <Badge tone="accent">{childCount} prompt(s)</Badge>}
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4 pl-9">
          <NodeChip
            label={`${cat.label} (categoria)`}
            doc={catDoc}
            onClick={() => onEdit({ scope: 'category', key: cat.value, label: `Categoria: ${cat.label}` })}
          />
          {cat.subcategories
            .filter((sub) => sub.value !== 'other')
            .map((sub) => (
              <div key={sub.value} className="flex flex-col gap-1.5">
                <NodeChip
                  label={sub.label}
                  doc={byKey.get(ctxKey('subcategory', sub.value))}
                  onClick={() => onEdit({ scope: 'subcategory', key: sub.value, label: `Subcategoria: ${sub.label}` })}
                />
                {(sub.items ?? []).filter((it) => it.value !== 'other').length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pl-5">
                    {(sub.items ?? [])
                      .filter((it) => it.value !== 'other')
                      .map((it) => {
                        const key = `${sub.value}/${it.value}`;
                        return (
                          <li key={it.value}>
                            <NodeChip
                              small
                              label={it.label}
                              doc={byKey.get(ctxKey('item', key))}
                              onClick={() => onEdit({ scope: 'item', key, label: `${sub.label} → ${it.label}` })}
                            />
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function NodeChip({
  label, doc, onClick, small,
}: {
  label: string;
  doc?: AiTrainingContext | null;
  onClick: () => void;
  small?: boolean;
}) {
  const has = !!doc;
  return (
    <button
      type="button"
      onClick={onClick}
      title={has ? 'Editar prompt' : 'Adicionar prompt'}
      className={cn(
        'inline-flex w-fit items-center gap-2 rounded-full border transition-colors',
        small ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/60',
        has
          ? 'border-accent-400/35 bg-accent-400/[0.08] text-ink-800 hover:border-accent-400/60'
          : 'border-white/[0.08] bg-white/[0.03] text-ink-600 hover:border-white/[0.18] hover:text-ink-800',
      )}
    >
      {label}
      {has ? (
        <Badge tone={doc!.enabled ? 'accent' : 'neutral'}>
          {doc!.enabled ? `${doc!.prompts.length} texto(s)` : 'desativado'}
        </Badge>
      ) : (
        <span aria-hidden className="text-ink-400">+</span>
      )}
    </button>
  );
}

// ─── Modal de edição ───────────────────────────────────────────────────────

function EditContextModal({
  target, existing, onClose,
}: {
  target: EditTarget;
  existing: AiTrainingContext | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Lista de textos do nó — cada um vira um item da seção no contexto final.
  const [prompts, setPrompts] = useState<string[]>(
    existing && existing.prompts.length > 0 ? existing.prompts : [''],
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const cleaned = prompts.map((p) => p.trim()).filter(Boolean);

  const save = useMutation({
    mutationFn: () =>
      upsertAiContext({ scope: target.scope, key: target.key, prompts: cleaned, enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-training'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao salvar'),
  });

  const del = useMutation({
    mutationFn: () => deleteAiContext(target.scope, target.key),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-training'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao excluir'),
  });

  function setAt(i: number, value: string) {
    setPrompts((prev) => prev.map((p, j) => (j === i ? value.slice(0, AI_CONTEXT_PROMPT_MAX) : p)));
  }
  function removeAt(i: number) {
    setPrompts((prev) => (prev.length <= 1 ? [''] : prev.filter((_, j) => j !== i)));
  }

  return (
    <Modal onClose={onClose} title={target.label} maxWidth="max-w-2xl">
      <p className="mb-3 text-sm text-ink-400">
        Estes textos entram como contexto nas análises de IA dos canais com esse perfil.
        Escreva instruções diretas (jargões do nicho, o que é positivo/negativo, o que observar),
        um assunto por texto.
      </p>

      <ul className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-1">
        {prompts.map((p, i) => (
          <li key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-400">
              <span className="font-medium uppercase tracking-[0.14em]">Texto {i + 1}</span>
              <div className="flex items-center gap-3">
                <span className="tabular-nums">{p.length}/{AI_CONTEXT_PROMPT_MAX}</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`Remover texto ${i + 1}`}
                  className="text-ink-400 transition-colors hover:text-err"
                >
                  remover ✕
                </button>
              </div>
            </div>
            <textarea
              value={p}
              onChange={(e) => setAt(i, e.target.value)}
              rows={3}
              placeholder={'ex: Em lives de Valorant, "ace", "clutch" e "diff" indicam momentos de destaque…'}
              className={
                'w-full rounded-lg border border-white/[0.08] bg-white/[0.04] p-3 text-sm text-ink-800 ' +
                'placeholder:text-ink-400/60 focus:border-accent-400/60 focus:outline-none focus:ring-2 focus:ring-accent-400/20'
              }
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-400">
        <Button
          variant="ghost"
          size="sm"
          disabled={prompts.length >= AI_CONTEXT_PROMPTS_PER_NODE}
          onClick={() => setPrompts((prev) => [...prev, ''])}
        >
          + Adicionar texto
        </Button>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#d7fe01]"
          />
          Ativo
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-err/30 bg-err/[0.08] px-3 py-2 text-sm text-err">{error}</p>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        <div>
          {existing && (
            <Button
              variant="destructive"
              size="sm"
              loading={del.isPending}
              onClick={() => {
                if (window.confirm('Excluir todos os textos deste item?')) del.mutate();
              }}
            >
              Excluir
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button
            size="sm"
            loading={save.isPending}
            disabled={cleaned.length === 0}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Prévia por canal ──────────────────────────────────────────────────────

function PreviewCard() {
  const [channelId, setChannelId] = useState('');
  const channels = useQuery({ queryKey: ['channels-v2'], queryFn: fetchChannels });

  const preview = useQuery({
    enabled: !!channelId,
    queryKey: ['ai-training-preview', channelId],
    queryFn: () => previewAiContext(channelId),
  });

  return (
    <Card>
      <CardHeader
        eyebrow="Validação"
        title="Prévia por canal"
        description="Veja exatamente o contexto que a IA recebe para um canal."
        actions={
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            aria-label="Canal da prévia"
            className="h-9 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 text-sm text-ink-800 focus:border-accent-400/60 focus:outline-none"
          >
            <option value="" className="bg-bg-1">Escolha um canal…</option>
            {(channels.data ?? []).map((c) => (
              <option key={c.id} value={c.id} className="bg-bg-1">
                {c.displayName ?? c.name}
              </option>
            ))}
          </select>
        }
      />
      {!channelId ? (
        <p className="text-sm text-ink-400">Selecione um canal para montar a prévia.</p>
      ) : preview.isLoading ? (
        <p className="text-sm text-ink-400">montando contexto…</p>
      ) : preview.isError ? (
        <p className="text-sm text-err">Não foi possível montar a prévia.</p>
      ) : (
        <>
          {(preview.data!.parts.length > 0) && (
            <ul className="mb-3 flex flex-wrap gap-1.5">
              {preview.data!.parts.map((p) => (
                <li key={`${p.scope}:${p.key}:${p.index}`}>
                  <Badge tone={p.included ? 'accent' : 'negative'}>
                    {p.scope}{p.key ? `: ${p.key}` : ''} #{p.index + 1}{p.included ? '' : ' (cortado)'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {preview.data!.context ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs leading-relaxed text-ink-700">
              {preview.data!.context}
            </pre>
          ) : (
            <p className="text-sm text-ink-400">
              Nenhum contexto aplicável: o canal não tem perfil/marcas que casem com os prompts, ou não há prompts ativos.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
