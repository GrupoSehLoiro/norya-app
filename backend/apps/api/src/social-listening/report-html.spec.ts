import { buildReportHtml, emotesToHtml, escapeHtml, type ReportEmote } from './report-html';
import type { ReportData } from './insights-report.service';

const DICT: ReportEmote[] = [
  { code: 'KEKW', url: 'https://cdn.betterttv.net/emote/abc/1x' },
  { code: 'PogChamp', url: 'https://static-cdn.jtvnw.net/emoticons/v2/305954156/static/light/1.0' },
];

const dictMap = new Map(DICT.map((e) => [e.code, e]));

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    channelName: 'gabs_tv',
    from: new Date('2026-07-20T00:00:00Z'),
    to: new Date('2026-07-21T00:00:00Z'),
    metrics: {
      totalMessages: 1234,
      activeDays: 2,
      peakUsers: 99,
      windows: 20,
      peak: { at: new Date('2026-07-20T21:00:00Z'), messages: 200 },
      sentiment: { pos: 0.6, neu: 0.3, neg: 0.1 },
      topCategories: [{ category: 'gameplay', count: 12 }],
      topKeywords: [
        { word: 'KEKW', count: 9 },
        { word: 'clutch', count: 7 },
      ],
      brands: [{ brand: 'Coca-Cola', count: 5 }],
      toxicUsers: [{ username: 'troll', ratio: 0.42 }],
    },
    narrative: {
      resumoExecutivo: 'Chat animado, muito KEKW nos momentos de clutch.',
      secoes: [{ titulo: 'Clima', corpo: 'Tom positivo com PogChamp frequente.' }],
    },
    generatedByAi: true,
    sampleSize: 60,
    peakInsight: 'Pico puxado por clipe — chat spammou KEKW.',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapa os cinco metacaracteres', () => {
    expect(escapeHtml(`<script>alert("x&'y")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;&#39;y&quot;)&lt;/script&gt;',
    );
  });
});

describe('emotesToHtml', () => {
  it('troca palavra do dicionário por <img> e preserva o resto', () => {
    const html = emotesToHtml('boa KEKW demais', dictMap);
    expect(html).toContain('<img class="emote" src="https://cdn.betterttv.net/emote/abc/1x"');
    expect(html).toContain('alt="KEKW"');
    expect(html).toContain('boa ');
    expect(html).toContain(' demais');
  });

  it('só casa palavra inteira (KEKWzinho não vira emote)', () => {
    expect(emotesToHtml('KEKWzinho', dictMap)).toBe('KEKWzinho');
  });

  it('renderiza marcador nativo do Kick pelo ID, sem dicionário', () => {
    const html = emotesToHtml('GG [emote:37226:EZ] demais', new Map());
    expect(html).toContain('src="https://files.kick.com/emotes/37226/fullsize"');
    expect(html).toContain('alt="EZ"');
    expect(html).not.toContain('[emote:');
  });

  it('escapa HTML malicioso vindo do chat, inclusive em nome de emote kick', () => {
    const html = emotesToHtml('<img onerror=x> [emote:1:<b>] fim', dictMap);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(html).toContain('alt="&lt;b&gt;"');
  });
});

describe('buildReportHtml', () => {
  it('gera documento completo com capa, métricas e emotes nas seções', () => {
    const html = buildReportHtml(baseData(), DICT);
    expect(html).toContain('gabs_tv');
    expect(html).toContain('RELATÓRIO DE COMUNIDADE DA LIVE');
    // resumo executivo e narrativa com emote como imagem
    expect(html.match(/class="emote"/g)!.length).toBeGreaterThanOrEqual(3);
    // chips de palavras-chave: KEKW vira imagem, clutch fica texto
    expect(html).toContain('<span class="chip">clutch</span>');
    // barras de sentimento com os percentuais
    expect(html).toContain('Positivo 60%');
    expect(html).toContain('Negativo 10%');
    // toxicidade em vermelho
    expect(html).toContain('bar-row negative');
  });

  it('escapa nome de canal hostil', () => {
    const html = buildReportHtml(baseData({ channelName: '<script>x</script>' }), []);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('sem pico e sem seções opcionais não quebra', () => {
    const data = baseData({ peakInsight: null });
    data.metrics.peak = null;
    data.metrics.brands = [];
    data.metrics.toxicUsers = [];
    data.metrics.topKeywords = [];
    data.metrics.topCategories = [];
    const html = buildReportHtml(data, []);
    expect(html).toContain('Sem pico de engajamento destacado');
    expect(html).not.toContain('Marcas mencionadas');
  });
});
