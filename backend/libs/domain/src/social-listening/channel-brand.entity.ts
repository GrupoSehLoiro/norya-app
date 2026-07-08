/**
 * ChannelBrand — entrada do allowlist de marcas que um canal monitora.
 *
 * O `regex` opcional permite expressões mais flexíveis ("yoda[\s-]?snacks?")
 * — quando ausente, `name` + `aliases` viram um regex `\b(name|alias1|...)\b`
 * case-insensitive automaticamente.
 */
export interface ChannelBrand {
  id: string;
  channelId: string;
  /** Nome canônico mostrado no insight (ex: "YoDaSnacks"). */
  name: string;
  aliases: string[];
  /** Override de regex; se vazio, derivamos de name+aliases. */
  regex: string | null;
  createdAt: Date;
}
