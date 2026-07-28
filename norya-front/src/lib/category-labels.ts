/**
 * Rótulos humanos para as categorias (pautas) do classificador — o pipeline
 * grava slugs técnicos ("gameplay-negative", "spam/gibberish") e o console
 * precisa mostrar nomes legíveis. Espelho do backend
 * (apps/api/src/social-listening/category-labels.ts, versão pt).
 */
const LABELS: Record<string, string> = {
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
};

export function humanizeCategory(slug: string): string {
  const known = LABELS[slug.toLowerCase()];
  if (known) return known;
  // Slug desconhecido: separadores viram espaço + inicial maiúscula.
  const pretty = slug.replace(/[-_/]+/g, ' ').trim();
  return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : slug;
}
