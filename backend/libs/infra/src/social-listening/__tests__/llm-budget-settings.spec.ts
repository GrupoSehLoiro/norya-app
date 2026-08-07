import { LLM_BUDGET_HARD_DEFAULTS, mergeEffectiveBudget } from '../llm-budget-settings.service';

describe('mergeEffectiveBudget — precedência channel → global → env → default', () => {
  const env = { monthlyTokens: 10_000_000, tokensPerMinute: 5_000 };

  it('sem docs: usa env; sem env: hard defaults', () => {
    expect(mergeEffectiveBudget(env, null, null)).toEqual({
      monthlyTokens: 10_000_000,
      tokensPerMinute: 5_000,
      paused: false,
      source: 'env',
    });
    expect(mergeEffectiveBudget({}, null, null)).toEqual({
      monthlyTokens: LLM_BUDGET_HARD_DEFAULTS.monthlyTokens,
      tokensPerMinute: LLM_BUDGET_HARD_DEFAULTS.tokensPerMinute,
      paused: false,
      source: 'default',
    });
  });

  it('global sobrepõe env; channel sobrepõe global — campo a campo', () => {
    const global = { monthlyTokens: 20_000_000, tokensPerMinute: undefined, paused: false };
    const channel = { monthlyTokens: undefined, tokensPerMinute: 1_000, paused: false };
    const out = mergeEffectiveBudget(env, global, channel);
    expect(out.monthlyTokens).toBe(20_000_000); // channel não define → global
    expect(out.tokensPerMinute).toBe(1_000); // channel define → vence
    expect(out.source).toBe('global'); // origem do teto MENSAL
  });

  it('channel com teto mensal próprio → source=channel', () => {
    const channel = { monthlyTokens: 999, tokensPerMinute: undefined, paused: false };
    expect(mergeEffectiveBudget(env, null, channel).source).toBe('channel');
  });

  it('paused é OR: global pausado pausa todos; canal pausado só ele', () => {
    const g = { monthlyTokens: undefined, tokensPerMinute: undefined, paused: true };
    const c = { monthlyTokens: undefined, tokensPerMinute: undefined, paused: false };
    expect(mergeEffectiveBudget(env, g, c).paused).toBe(true);
    expect(mergeEffectiveBudget(env, null, { ...c, paused: true }).paused).toBe(true);
    expect(mergeEffectiveBudget(env, { ...g, paused: false }, c).paused).toBe(false);
  });
});
