/**
 * Visual das marcas: logo (quando conhecemos o domínio) + cor vibrante
 * determinística (fallback quando não há logo).
 *
 * Estratégia (SaaS-friendly): NÃO versionamos ~200 PNGs de logo (rebrands
 * quebram, trademark, peso de bundle, e marcas custom nunca teriam imagem).
 * Em vez disso pedimos o logo a um serviço por domínio — cacheado pelo
 * browser — e caímos num chip colorido sempre que o domínio é desconhecido
 * ou a imagem falha (`<img onError>`). O chip colorido é o herói: funciona
 * 100% offline, para marca custom e para logo 404.
 *
 * Para trocar a fonte de logo (ex.: logo.dev com token, self-host), basta
 * mexer em `brandLogoUrl` — o resto do app não muda.
 */

/** Normaliza um nome de marca para chave de lookup: minúsculo, sem acento/símbolo. */
export function normalizeBrand(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Marca → domínio (chave = `normalizeBrand(nome)`). Curado a partir do
 * catálogo seed do backend. O que não estiver aqui cai no chip colorido —
 * é intencional, evita mostrar o "globo genérico" de favicon inexistente.
 */
const BRAND_DOMAINS: Record<string, string> = {
  // Tech / hardware
  apple: 'apple.com', samsung: 'samsung.com', google: 'google.com',
  microsoft: 'microsoft.com', sony: 'sony.com', intel: 'intel.com',
  amd: 'amd.com', nvidia: 'nvidia.com', logitech: 'logitech.com',
  razer: 'razer.com', hyperx: 'hyperx.com', corsair: 'corsair.com',
  steelseries: 'steelseries.com', elgato: 'elgato.com', asus: 'asus.com',
  msi: 'msi.com', acer: 'acer.com', dell: 'dell.com', hp: 'hp.com',
  lenovo: 'lenovo.com', xiaomi: 'mi.com', motorola: 'motorola.com',
  lg: 'lg.com', jbl: 'jbl.com', bose: 'bose.com', gopro: 'gopro.com',
  redragon: 'redragon.com', multilaser: 'multilaser.com.br',
  fortrek: 'fortrek.com.br', husky: 'husky.gg', pichau: 'pichau.com.br',
  kabum: 'kabum.com.br', terabyte: 'terabyteshop.com.br',
  aoc: 'aoc.com', positivo: 'positivo.com.br', intelbras: 'intelbras.com.br',
  logitechg: 'logitechg.com', lenovolegion: 'lenovo.com',
  samsungodyssey: 'samsung.com',
  // Games / plataformas
  playstation: 'playstation.com', xbox: 'xbox.com', nintendo: 'nintendo.com',
  steam: 'steampowered.com', epicgames: 'epicgames.com', riotgames: 'riotgames.com',
  electronicarts: 'ea.com', ubisoft: 'ubisoft.com', rockstargames: 'rockstargames.com',
  activision: 'activision.com', blizzard: 'blizzard.com', garena: 'garena.com',
  roblox: 'roblox.com', supercell: 'supercell.com', mojang: 'minecraft.net',
  valve: 'valvesoftware.com', mihoyo: 'hoyoverse.com', tencent: 'tencent.com',
  // Streaming / social
  twitch: 'twitch.tv', kick: 'kick.com', youtube: 'youtube.com',
  netflix: 'netflix.com', disney: 'disneyplus.com', primevideo: 'primevideo.com',
  max: 'max.com', spotify: 'spotify.com', spotifypremium: 'spotify.com',
  crunchyroll: 'crunchyroll.com', discord: 'discord.com', tiktok: 'tiktok.com',
  instagram: 'instagram.com', whatsapp: 'whatsapp.com', telegram: 'telegram.org',
  x: 'x.com', reddit: 'reddit.com', snapchat: 'snapchat.com', openai: 'openai.com',
  // Energéticos / bebidas
  redbull: 'redbull.com', monsterenergy: 'monsterenergy.com',
  monsterultra: 'monsterenergy.com', rockstarenergy: 'rockstarenergy.com',
  gfuel: 'gfuel.com', gamersupps: 'gamersupps.gg', baly: 'baly.com.br',
  cocacola: 'coca-cola.com', pepsi: 'pepsi.com', gatorade: 'gatorade.com',
  nescafe: 'nescafe.com', heineken: 'heineken.com', budweiser: 'budweiser.com',
  brahma: 'brahma.com.br', brahmaduplomalte: 'brahma.com.br', skol: 'skol.com.br',
  itaipava: 'itaipava.com.br', ambev: 'ambev.com.br',
  // Fast food / delivery / alimentos
  burgerking: 'bk.com', kfc: 'kfc.com', subway: 'subway.com',
  starbucks: 'starbucks.com', pizzahut: 'pizzahut.com', giraffas: 'giraffas.com.br',
  ifood: 'ifood.com.br', rappi: 'rappi.com.br', nestle: 'nestle.com',
  nutella: 'nutella.com', pringles: 'pringles.com', doritos: 'doritos.com',
  oreo: 'oreo.com', bauducco: 'bauducco.com.br', sadia: 'sadia.com.br',
  perdigao: 'perdigao.com.br', friboi: 'friboi.com.br', seara: 'seara.com.br',
  feastables: 'feastables.com',
  // Moda / esporte / beleza
  nike: 'nike.com', adidas: 'adidas.com', puma: 'puma.com',
  underarmour: 'underarmour.com', reebok: 'reebok.com', vans: 'vans.com',
  converse: 'converse.com', newbalance: 'newbalance.com', lacoste: 'lacoste.com',
  supreme: 'supremenewyork.com', thenorthface: 'thenorthface.com', zara: 'zara.com',
  hm: 'hm.com', gucci: 'gucci.com', louisvuitton: 'louisvuitton.com',
  havaianas: 'havaianas.com.br', osklen: 'osklen.com.br', centauro: 'centauro.com.br',
  natura: 'natura.com.br', oboticario: 'boticario.com.br', avon: 'avon.com.br',
  gillette: 'gillette.com', nivea: 'nivea.com.br', dove: 'dove.com',
  oldspice: 'oldspice.com',
  // E-commerce
  amazon: 'amazon.com', mercadolivre: 'mercadolivre.com.br', shopee: 'shopee.com.br',
  aliexpress: 'aliexpress.com', shein: 'shein.com', magazineluiza: 'magazineluiza.com.br',
  casasbahia: 'casasbahia.com.br', americanas: 'americanas.com.br',
  ponto: 'pontofrio.com.br', ebay: 'ebay.com',
  // Fintech / bancos / pagamentos
  nubank: 'nubank.com.br', picpay: 'picpay.com', mercadopago: 'mercadopago.com.br',
  pagbank: 'pagbank.com.br', bancointer: 'inter.co', c6bank: 'c6bank.com.br',
  itau: 'itau.com.br', bradesco: 'bradesco.com.br', bancodobrasil: 'bb.com.br',
  santander: 'santander.com.br', caixa: 'caixa.gov.br', xpinvestimentos: 'xpi.com.br',
  stone: 'stone.com.br', visa: 'visa.com', mastercard: 'mastercard.com',
  paypal: 'paypal.com', binance: 'binance.com', coinbase: 'coinbase.com',
  mercadobitcoin: 'mercadobitcoin.com.br',
  // Telecom / mobilidade
  vivo: 'vivo.com.br', claro: 'claro.com.br', tim: 'tim.com.br', oi: 'oi.com.br',
  uber: 'uber.com', '99': '99app.com',
  // Automotivo
  toyota: 'toyota.com', honda: 'honda.com', volkswagen: 'volkswagen.com',
  ford: 'ford.com', chevrolet: 'chevrolet.com', fiat: 'fiat.com.br', jeep: 'jeep.com',
  bmw: 'bmw.com', mercedesbenz: 'mercedes-benz.com', audi: 'audi.com',
  porsche: 'porsche.com', tesla: 'tesla.com', hyundai: 'hyundai.com', nissan: 'nissan.com',
  // Apostas
  betano: 'betano.com', bet365: 'bet365.com', blaze: 'blaze.com', stake: 'stake.com',
  sportingbet: 'sportingbet.com', betfair: 'betfair.com', pixbet: 'pixbet.com',
  superbet: 'superbet.com',
  // Serviços
  nordvpn: 'nordvpn.com', expressvpn: 'expressvpn.com', hostinger: 'hostinger.com',
};

/**
 * URL do logo da marca, ou `null` se o domínio é desconhecido (→ chip colorido).
 * Fonte: serviço de favicon do Google (grátis, sem chave, cacheado). Ponto
 * único de troca caso queira logos maiores via logo.dev/self-host.
 */
export function brandLogoUrl(name: string): string | null {
  const domain = BRAND_DOMAINS[normalizeBrand(name)];
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
}

export interface BrandAccent {
  hue: number;
  /** texto/ícone sobre fundo escuro */
  text: string;
  /** borda do chip */
  border: string;
  /** tint de fundo do chip (translúcido) */
  bg: string;
  /** fundo sólido do avatar quando não há logo */
  solid: string;
  /** texto das iniciais sobre o fundo sólido */
  solidInk: string;
}

/** Cor vibrante determinística por nome (hash → matiz HSL fixo e saturado). */
export function brandAccent(name: string): BrandAccent {
  const key = normalizeBrand(name) || name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    hue,
    text: `hsl(${hue} 88% 74%)`,
    border: `hsl(${hue} 82% 62% / 0.5)`,
    bg: `hsl(${hue} 72% 55% / 0.13)`,
    solid: `hsl(${hue} 62% 46%)`,
    solidInk: `hsl(${hue} 92% 94%)`,
  };
}

/** Iniciais para o avatar sem-logo (1–2 letras, sem símbolos). */
export function brandInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '#';
  const second = words[1];
  if (!second) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
}
