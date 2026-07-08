/**
 * Taxonomia seed do onboarding (categoria → subcategoria → item específico).
 *
 * Seed fixo + texto livre. 3 níveis: ex. Games → FPS/Tiro → Valorant. O item
 * específico (3º nível) é gravado em `CreatorProfile.tags`. `audience.ageRange`
 * e `niche` (livre) seguem; gênero/tamanho/região/gênero-do-público foram
 * removidos do onboarding.
 */
export interface TaxonomyOption {
  value: string;
  label: string;
}

export interface SubcategoryNode extends TaxonomyOption {
  /** 3º nível — títulos/itens específicos. Quando presente, o front mostra um select. */
  items?: TaxonomyOption[];
}

export interface CategoryNode extends TaxonomyOption {
  subcategories: SubcategoryNode[];
}

const OTHER: TaxonomyOption = { value: 'other', label: 'Outro' };
/** Helper: monta items a partir de uma lista de nomes (+ "Outro"). */
const items = (...names: string[]): TaxonomyOption[] => [
  ...names.map((n) => ({ value: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: n })),
  OTHER,
];

export const CATEGORIES: CategoryNode[] = [
  {
    value: 'games',
    label: 'Games',
    subcategories: [
      {
        value: 'fps',
        label: 'FPS / Tiro',
        items: items(
          'Valorant',
          'CS2',
          'Apex Legends',
          'Call of Duty',
          'Overwatch 2',
          'Rainbow Six Siege',
          'PUBG',
          'Free Fire',
          'The Finals',
        ),
      },
      {
        value: 'moba',
        label: 'MOBA',
        items: items('League of Legends', 'Dota 2', 'Wild Rift', 'Heroes of the Storm'),
      },
      {
        value: 'battle_royale',
        label: 'Battle Royale',
        items: items('Fortnite', 'Warzone', 'PUBG', 'Free Fire', 'Apex Legends', 'Fall Guys'),
      },
      {
        value: 'mmorpg',
        label: 'MMORPG',
        items: items(
          'World of Warcraft',
          'Final Fantasy XIV',
          'Lost Ark',
          'Tibia',
          'Throne and Liberty',
          'New World',
        ),
      },
      {
        value: 'rpg',
        label: 'RPG',
        items: items(
          'Elden Ring',
          "Baldur's Gate 3",
          'The Witcher 3',
          'Cyberpunk 2077',
          'Diablo IV',
        ),
      },
      {
        value: 'survival_sandbox',
        label: 'Survival / Sandbox',
        items: items('Minecraft', 'Rust', 'ARK', 'Valheim', 'DayZ', 'Palworld'),
      },
      {
        value: 'fighting',
        label: 'Luta',
        items: items('Street Fighter 6', 'Tekken 8', 'Mortal Kombat 1', 'Guilty Gear'),
      },
      {
        value: 'racing',
        label: 'Corrida',
        items: items('Forza Horizon', 'Gran Turismo', 'F1', 'Mario Kart', 'Rocket League'),
      },
      {
        value: 'sports_games',
        label: 'Esportivos',
        items: items('EA FC (FIFA)', 'NBA 2K', 'eFootball'),
      },
      {
        value: 'strategy',
        label: 'Estratégia / RTS',
        items: items('Age of Empires', 'StarCraft II', 'Civilization', 'Clash Royale'),
      },
      {
        value: 'card_autobattler',
        label: 'Cartas / Auto-battler',
        items: items('Hearthstone', 'Legends of Runeterra', 'Teamfight Tactics', 'Balatro'),
      },
      {
        value: 'horror',
        label: 'Terror',
        items: items('Resident Evil', 'Phasmophobia', 'Lethal Company'),
      },
      {
        value: 'soulslike',
        label: 'Soulslike',
        items: items('Elden Ring', 'Dark Souls', 'Lies of P', 'Sekiro'),
      },
      {
        value: 'platformer',
        label: 'Plataforma',
        items: items('Celeste', 'Hollow Knight', 'Super Mario'),
      },
      {
        value: 'simulation',
        label: 'Simulação',
        items: items('The Sims', 'Stardew Valley', 'Cities Skylines'),
      },
      {
        value: 'gacha',
        label: 'Gacha',
        items: items('Genshin Impact', 'Honkai Star Rail', 'Wuthering Waves', 'Zenless Zone Zero'),
      },
      {
        value: 'mobile',
        label: 'Mobile',
        items: items('Free Fire', 'Mobile Legends', 'Clash Royale', 'Wild Rift'),
      },
      { value: 'speedrun', label: 'Speedrun' },
      { value: 'retro', label: 'Retrô' },
      { value: 'indie', label: 'Indie' },
      OTHER,
    ],
  },
  {
    value: 'esports',
    label: 'E-sports',
    subcategories: [
      {
        value: 'official_broadcast',
        label: 'Transmissão oficial',
        items: items('CBLOL', 'VCT', 'LCK', 'LEC', 'Major CS', 'CCT'),
      },
      { value: 'watch_party', label: 'Watch party' },
      { value: 'analysis', label: 'Análise / Caster' },
      { value: 'coaching', label: 'Coaching' },
      OTHER,
    ],
  },
  {
    value: 'just_chatting',
    label: 'Just Chatting / Variedades',
    subcategories: [
      { value: 'reacts', label: 'Reacts' },
      { value: 'podcast', label: 'Podcast' },
      { value: 'talk_show', label: 'Talk Show' },
      { value: 'qa', label: 'Perguntas & Respostas' },
      { value: 'debate', label: 'Debate' },
      { value: 'news_commentary', label: 'Comentário de notícias' },
      OTHER,
    ],
  },
  {
    value: 'irl',
    label: 'IRL / Lifestyle',
    subcategories: [
      { value: 'vlog', label: 'Vlog' },
      { value: 'travel', label: 'Viagem' },
      { value: 'cooking', label: 'Culinária' },
      { value: 'fitness', label: 'Fitness' },
      { value: 'asmr', label: 'ASMR' },
      { value: 'outdoors', label: 'Ao ar livre' },
      { value: 'pets', label: 'Pets' },
      { value: 'beauty', label: 'Beleza / Moda' },
      OTHER,
    ],
  },
  {
    value: 'music',
    label: 'Música',
    subcategories: [
      { value: 'dj', label: 'DJ / Sets' },
      { value: 'instrument', label: 'Instrumental' },
      { value: 'singing', label: 'Canto' },
      { value: 'production', label: 'Produção musical' },
      { value: 'karaoke', label: 'Karaokê' },
      OTHER,
    ],
  },
  {
    value: 'creative',
    label: 'Criativo',
    subcategories: [
      { value: 'art', label: 'Arte / Desenho' },
      { value: 'gamedev', label: 'Game Dev' },
      { value: 'programming', label: 'Programação' },
      { value: 'design', label: 'Design' },
      { value: 'writing', label: 'Escrita' },
      { value: '3d_modeling', label: 'Modelagem 3D' },
      OTHER,
    ],
  },
  {
    value: 'sports',
    label: 'Esportes',
    subcategories: [
      { value: 'football', label: 'Futebol' },
      { value: 'basketball', label: 'Basquete' },
      { value: 'mma', label: 'MMA / UFC' },
      { value: 'poker', label: 'Poker' },
      { value: 'chess', label: 'Xadrez' },
      { value: 'fitness_sport', label: 'Fitness / Treino' },
      OTHER,
    ],
  },
  {
    value: 'entertainment',
    label: 'Entretenimento',
    subcategories: [
      { value: 'movies_tv', label: 'Filmes & Séries' },
      { value: 'anime', label: 'Anime' },
      { value: 'comedy', label: 'Comédia' },
      { value: 'cosplay', label: 'Cosplay' },
      { value: 'vtuber', label: 'VTuber' },
      OTHER,
    ],
  },
  {
    value: 'education',
    label: 'Educação',
    subcategories: [
      { value: 'tutorials', label: 'Tutoriais' },
      { value: 'languages', label: 'Idiomas' },
      { value: 'science', label: 'Ciência' },
      { value: 'finance', label: 'Finanças' },
      { value: 'tech_edu', label: 'Tecnologia' },
      OTHER,
    ],
  },
  {
    value: 'betting_casino',
    label: 'Apostas / Cassino',
    subcategories: [
      { value: 'slots', label: 'Slots' },
      { value: 'sports_betting', label: 'Apostas esportivas' },
      { value: 'poker_casino', label: 'Poker' },
      { value: 'crash_games', label: 'Crash games' },
      OTHER,
    ],
  },
  {
    value: 'tech',
    label: 'Tecnologia',
    subcategories: [
      { value: 'hardware', label: 'Hardware / Setup' },
      { value: 'crypto', label: 'Cripto' },
      { value: 'ai', label: 'IA' },
      { value: 'reviews', label: 'Reviews' },
      OTHER,
    ],
  },
  {
    value: 'other',
    label: 'Outro',
    subcategories: [OTHER],
  },
];

export const AUDIENCE_AGE_RANGES: TaxonomyOption[] = [
  { value: '13-17', label: '13-17' },
  { value: '18-24', label: '18-24' },
  { value: '25-34', label: '25-34' },
  { value: '35-44', label: '35-44' },
  { value: '45+', label: '45+' },
  { value: 'mixed', label: 'Misto' },
];

export const TAXONOMY = {
  categories: CATEGORIES,
  audience: {
    ageRanges: AUDIENCE_AGE_RANGES,
  },
};

export type Taxonomy = typeof TAXONOMY;
