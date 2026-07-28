/**
 * Rótulos humanos para as categorias (pautas) do classificador.
 *
 * O pipeline grava slugs técnicos ("gameplay-negative", "spam/gibberish");
 * relatório e console precisam mostrar nomes legíveis. Slugs fora do
 * dicionário caem num prettifier genérico (separadores → espaço, inicial
 * maiúscula) para nunca vazar hífen/barra cru.
 *
 * Espelho no front: norya-front/src/lib/category-labels.ts (só pt).
 */
export type CategoryLang = 'pt' | 'en';

const LABELS: Record<CategoryLang, Record<string, string>> = {
  pt: {
    gameplay: 'Gameplay',
    'gameplay-positive': 'Elogios ao gameplay',
    'gameplay-negative': 'Críticas ao gameplay',
    'gameplay-config': 'Configurações e setup',
    'meta-stream': 'Conversa sobre a stream',
    'spam/gibberish': 'Spam e ruído',
    'spam/noise': 'Spam e ruído',
    'unclear/spam': 'Mensagens sem contexto',
    'emote-spam': 'Chuva de emotes',
    'emote-expression': 'Reações com emotes',
    'brand-mention': 'Menções a marcas',
    question: 'Perguntas ao streamer',
    greeting: 'Saudações',
    hype: 'Hype',
    'off-topic': 'Assuntos fora da live',
  },
  en: {
    gameplay: 'Gameplay',
    'gameplay-positive': 'Gameplay praise',
    'gameplay-negative': 'Gameplay criticism',
    'gameplay-config': 'Settings & setup',
    'meta-stream': 'Stream talk',
    'spam/gibberish': 'Spam & noise',
    'spam/noise': 'Spam & noise',
    'unclear/spam': 'Low-context messages',
    'emote-spam': 'Emote spam',
    'emote-expression': 'Emote reactions',
    'brand-mention': 'Brand mentions',
    question: 'Questions to the streamer',
    greeting: 'Greetings',
    hype: 'Hype',
    'off-topic': 'Off-topic chatter',
  },
};

export function humanizeCategory(slug: string, lang: CategoryLang = 'pt'): string {
  const known = LABELS[lang][slug.toLowerCase()];
  if (known) return known;
  // Prettifier genérico: "algum-slug/estranho" → "Algum slug estranho".
  const pretty = slug.replace(/[-_/]+/g, ' ').trim();
  return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : slug;
}
