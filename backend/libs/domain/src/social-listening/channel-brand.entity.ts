/**
 * ChannelBrand — entrada do allowlist de marcas que um canal monitora.
 *
 * O `regex` opcional permite expressões mais flexíveis ("yoda[\s-]?snacks?")
 * — quando ausente, `name` + `aliases` viram um regex `\b(name|alias1|...)\b`
 * case-insensitive automaticamente.
 */
export interface ChannelBrand {
  id: string;
  /**
   * Creator dono da marca — eixo PRINCIPAL de escopo. A allowlist é individual
   * do criador (não do canal): a mesma conta de plataforma pode ser reaproveitada
   * por creators/donos diferentes, então marca por canal vazava entre usuários.
   */
  creatorId: string;
  /**
   * Canal de origem no momento da criação (proveniência/legado). Opcional — a
   * detecção e a listagem passaram a operar por `creatorId`.
   */
  channelId?: string | null;
  /** Nome canônico mostrado no insight (ex: "YoDaSnacks"). */
  name: string;
  aliases: string[];
  /** Override de regex; se vazio, derivamos de name+aliases. */
  regex: string | null;
  createdAt: Date;
}
