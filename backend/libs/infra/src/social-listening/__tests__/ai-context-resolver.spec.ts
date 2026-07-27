import { AiContextResolverService } from '../ai-context-resolver.service';
import type { AiTrainingContextPersistence } from '../../persistence/mongoose/schemas/ai-training-context.schema';

/**
 * Unit tests do resolver de contexto de Treinamento IA — deps todas mockadas
 * (model Mongoose, ports de channel/profile, repo de marcas).
 */

type Doc = Pick<AiTrainingContextPersistence, 'scope' | 'key' | 'prompts' | 'enabled'>;

function makeModel(docs: Doc[]) {
  return {
    find: jest.fn((filter: { $or: Array<{ scope: string; key?: { $in: string[] } }> }) => ({
      lean: () => ({
        exec: async () =>
          docs.filter((d) => {
            if (!d.enabled) return false;
            return filter.$or.some(
              (c) => c.scope === d.scope && (!c.key || c.key.$in.includes(d.key)),
            );
          }),
      }),
    })),
  };
}

function makeChannel(creatorId?: string) {
  return { findById: jest.fn(async () => ({ getCreatorId: () => creatorId })) };
}

function makeProfiles(p: { category?: string; subcategory?: string; tags?: string[] } | null) {
  return {
    findByCreatorId: jest.fn(async () =>
      p
        ? {
            toPersistence: () => ({
              category: p.category ?? '',
              subcategory: p.subcategory ?? '',
              tags: p.tags ?? [],
            }),
          }
        : null,
    ),
  };
}

function makeBrands(names: string[]) {
  return { listByCreator: jest.fn(async () => names.map((name) => ({ name }))) };
}

function build(opts: {
  docs: Doc[];
  creatorId?: string;
  profile?: { category?: string; subcategory?: string; tags?: string[] } | null;
  brands?: string[];
}) {
  return new AiContextResolverService(
    makeModel(opts.docs) as never,
    makeChannel(opts.creatorId) as never,
    makeProfiles(opts.profile ?? null) as never,
    makeBrands(opts.brands ?? []) as never,
  );
}

const DOCS: Doc[] = [
  { scope: 'global', key: '', prompts: ['prompt-global'], enabled: true },
  { scope: 'category', key: 'games', prompts: ['prompt-games'], enabled: true },
  { scope: 'subcategory', key: 'fps', prompts: ['prompt-fps'], enabled: true },
  { scope: 'item', key: 'fps/valorant', prompts: ['prompt-valorant'], enabled: true },
  { scope: 'brand', key: 'coca-cola', prompts: ['prompt-coca'], enabled: true },
];

describe('AiContextResolverService', () => {
  it('perfil completo: monta geral → específico com todas as seções', async () => {
    const svc = build({
      docs: DOCS,
      creatorId: 'crt-1',
      profile: { category: 'games', subcategory: 'fps', tags: ['fps/valorant'] },
      brands: ['Coca-Cola'],
    });
    const r = await svc.resolveDetailed('chan-1');
    expect(r.text).toBeTruthy();
    const t = r.text!;
    expect(t.indexOf('prompt-global')).toBeLessThan(t.indexOf('prompt-games'));
    expect(t.indexOf('prompt-games')).toBeLessThan(t.indexOf('prompt-fps'));
    expect(t.indexOf('prompt-fps')).toBeLessThan(t.indexOf('prompt-valorant'));
    expect(t.indexOf('prompt-valorant')).toBeLessThan(t.indexOf('prompt-coca'));
    expect(r.parts).toHaveLength(5);
    expect(r.parts.every((p) => p.included)).toBe(true);
  });

  it('canal sem creator: só global (allowlist é por creator)', async () => {
    // Marcas passaram a ser escopadas por creatorId: sem creator vinculado não
    // há allowlist a resolver (evita vazamento entre donos do mesmo canal).
    const svc = build({ docs: DOCS, creatorId: undefined, brands: ['coca-cola'] });
    const r = await svc.resolveDetailed('chan-1');
    expect(r.text).toContain('prompt-global');
    expect(r.text).not.toContain('prompt-coca');
    expect(r.text).not.toContain('prompt-games');
  });

  it('prompt desabilitado fica de fora', async () => {
    const docs = DOCS.map((d) => (d.scope === 'category' ? { ...d, enabled: false } : d));
    const svc = build({
      docs,
      creatorId: 'crt-1',
      profile: { category: 'games' },
    });
    const r = await svc.resolveDetailed('chan-1');
    expect(r.text).not.toContain('prompt-games');
  });

  it('cap total: descarta prompts do fim inteiros (included=false), nunca corta no meio', async () => {
    const big = 'x'.repeat(1800);
    const docs: Doc[] = [
      { scope: 'global', key: '', prompts: [big], enabled: true },
      { scope: 'category', key: 'games', prompts: [big], enabled: true },
      { scope: 'subcategory', key: 'fps', prompts: [big], enabled: true }, // não cabe (>4000)
    ];
    const svc = build({
      docs,
      creatorId: 'crt-1',
      profile: { category: 'games', subcategory: 'fps' },
    });
    const r = await svc.resolveDetailed('chan-1');
    expect(r.text!.length).toBeLessThanOrEqual(4000);
    const dropped = r.parts.filter((p) => !p.included);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.scope).toBe('subcategory');
    // o descartado não aparece nem parcialmente
    expect((r.text!.match(/x{100,}/g) ?? []).length).toBe(2);
  });

  it('sem docs aplicáveis → text null', async () => {
    const svc = build({ docs: [], creatorId: 'crt-1', profile: { category: 'games' } });
    const r = await svc.resolveDetailed('chan-1');
    expect(r.text).toBeNull();
    expect(r.parts).toHaveLength(0);
  });

  it('fail-open: erro no Mongo → text null, sem lançar', async () => {
    const model = {
      find: jest.fn(() => ({
        lean: () => ({ exec: async () => Promise.reject(new Error('mongo down')) }),
      })),
    };
    const svc = new AiContextResolverService(
      model as never,
      makeChannel('crt-1') as never,
      makeProfiles({ category: 'games' }) as never,
      makeBrands([]) as never,
    );
    await expect(svc.resolveForChannel('chan-1')).resolves.toBeNull();
  });

  it('cache por canal + invalidateAll', async () => {
    const model = makeModel(DOCS);
    const svc = new AiContextResolverService(
      model as never,
      makeChannel('crt-1') as never,
      makeProfiles({ category: 'games' }) as never,
      makeBrands([]) as never,
    );
    await svc.resolveForChannel('chan-1');
    await svc.resolveForChannel('chan-1');
    expect(model.find).toHaveBeenCalledTimes(1); // 2ª veio do cache
    svc.invalidateAll();
    await svc.resolveForChannel('chan-1');
    expect(model.find).toHaveBeenCalledTimes(2);
  });

  it('vários textos num nó viram lista com marcadores; cap descarta por TEXTO', async () => {
    const docs: Doc[] = [
      { scope: 'global', key: '', prompts: ['texto-um', 'texto-dois'], enabled: true },
      {
        scope: 'category',
        key: 'games',
        prompts: ['cabe-'.padEnd(3300, 'y'), 'nao-cabe-'.padEnd(1000, 'z')],
        enabled: true,
      },
    ];
    const svc = build({ docs, creatorId: 'crt-1', profile: { category: 'games' } });
    const r = await svc.resolveDetailed('chan-1');
    // nó com 2 textos rende bullets
    expect(r.text).toContain('- texto-um');
    expect(r.text).toContain('- texto-dois');
    // no nó games, o 1º texto cabe e o 2º é descartado inteiro
    const gamesParts = r.parts.filter((p) => p.scope === 'category');
    expect(gamesParts).toHaveLength(2);
    expect(gamesParts[0]!.included).toBe(true);
    expect(gamesParts[1]!.included).toBe(false);
    expect(r.text).not.toContain('nao-cabe-');
  });

  it('ignora tags "other" e chaves vazias do perfil', async () => {
    const svc = build({
      docs: DOCS,
      creatorId: 'crt-1',
      profile: { category: 'other', subcategory: '', tags: ['fps/other', 'other'] },
    });
    const r = await svc.resolveDetailed('chan-1');
    // só o global aplica
    expect(r.text).toContain('prompt-global');
    expect(r.text).not.toContain('prompt-games');
    expect(r.text).not.toContain('prompt-valorant');
  });
});
