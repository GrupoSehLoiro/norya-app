/**
 * ReportLlmService — gera o TEXTO de um relatório de análise da live usando
 * a MESMA IA do pipeline (Anthropic Haiku, mesmo ANTHROPIC_API_KEY/modelo).
 *
 * Diferente do classificador (tool `classify_batch`, saída estruturada de
 * sentimento), aqui pedimos texto editorial em pt-BR via uma tool
 * `gerar_relatorio` que devolve seções prontas para virar PDF.
 *
 * Respeita LLM_DRIVER: só chama a API quando 'real' e com chave presente.
 * Em qualquer outro caso (mock/fallback/sem chave/erro) devolve `null` — o
 * caller monta um relatório-template a partir dos números agregados.
 *
 * Custo:
 *  - system SEMPRE em blocos com cache_control (prompt caching): base
 *    (com sufixo de idioma) + extraContext do canal, cada um com seu
 *    breakpoint — tool + base cacheiam compartilhado, extraContext por canal.
 *  - `viaBatch: true` + env LLM_BATCH_API=true roteia a chamada pela
 *    Message Batches API (−50% no preço por token). Só para fluxos que
 *    toleram latência de minutos (relatório PDF); com timeout + fallback
 *    para a chamada sync se o batch demorar/falhar.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
/**
 * Teto de espera pelo batch antes de cair pra chamada sync (env
 * LLM_BATCH_TIMEOUT_MS). A Message Batches API é assíncrona de verdade — a
 * maioria dos batches termina em MINUTOS, e o SLA é de até 24h; não em
 * segundos. Um teto curto (o default aqui já foi 120s) faz o caminho barato
 * estourar em quase toda chamada, pagando a latência do polling E o preço
 * cheio do fallback sync. Só use `viaBatch` em fluxo que aguenta essa espera.
 */
const DEFAULT_BATCH_TIMEOUT_MS = 900_000;
/** Intervalo de polling do status do batch (env LLM_BATCH_POLL_MS). */
const DEFAULT_BATCH_POLL_MS = 10_000;

export interface ReportLlmInput {
  /** Texto já serializado com período, métricas agregadas e amostra de msgs. */
  context: string;
  /** Nome do canal/streamer para personalizar o tom. */
  channelName: string;
  /**
   * Bloco "Treinamento IA" do canal (AiContextResolver) — curadoria por
   * categoria/subcategoria/game/marca. Anexado ao system quando presente.
   */
  extraContext?: string;
  /** Idioma do texto gerado. Default pt-BR; 'en' escreve o relatório em inglês. */
  lang?: 'pt' | 'en';
  /**
   * Roteia esta chamada pela Message Batches API (−50%/token) quando
   * LLM_BATCH_API=true. Default false (chamada sync normal).
   *
   * NÃO use em caminho de request HTTP: o batch leva minutos e o handler
   * ficaria pendurado até LLM_BATCH_TIMEOUT_MS antes de cair no sync. É para
   * job offline / pré-geração agendada de relatório.
   */
  viaBatch?: boolean;
}

/** Bloco de system com breakpoint de prompt-cache (mesmo shape do classifier). */
interface CacheableTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * System em BLOCOS cacheados (antes era string crua sem cache nenhum):
 *   [0] base + sufixo de idioma  ← cache_control (compartilhado: tool + base)
 *   [1] extraContext do canal    ← cache_control (entrada por canal)
 * 2 breakpoints ≤ limite de 4 da API. Repetições da mesma tela/canal pagam
 * 0,1× nesses blocos em vez de preço cheio.
 */
function buildReportSystemBlocks(base: string, input: ReportLlmInput): CacheableTextBlock[] {
  const blocks: CacheableTextBlock[] = [
    { type: 'text', text: withLanguage(base, input), cache_control: { type: 'ephemeral' } },
  ];
  if (input.extraContext) {
    blocks.push({
      type: 'text',
      text: input.extraContext,
      cache_control: { type: 'ephemeral' },
    });
  }
  return blocks;
}

/**
 * Sobrepõe o idioma de saída quando o caller pediu inglês. Os prompts base
 * continuam em pt-BR (mesmo prompt cache); a instrução final vence.
 */
function withLanguage(system: string, input: ReportLlmInput): string {
  if (input.lang !== 'en') return system;
  return (
    `${system}\n\nIMPORTANT: Write ALL of your output text in ENGLISH (US) — ` +
    'titles, tags, bullets and summaries. The report will be delivered to an ' +
    'English-speaking audience. Keep usernames and literal chat quotes in their ' +
    'original language.'
  );
}

/**
 * Reforço de idioma na mensagem do usuário: só a instrução no system perde
 * para as descriptions das tools (todas em pt-BR) — o modelo respondia em
 * português mesmo com lang=en.
 */
function withUserLanguage(content: string, input: ReportLlmInput): string {
  if (input.lang !== 'en') return content;
  return `${content}\n\nWrite your ENTIRE response in ENGLISH (US), regardless of the language of the data above.`;
}

/**
 * Versão da tool com as descriptions traduzidas quando lang=en — as menções a
 * "português do Brasil" nas descriptions puxavam a resposta de volta pro pt.
 */
function localizedTool<T>(tool: T, input: ReportLlmInput): T {
  if (input.lang !== 'en') return tool;
  return JSON.parse(
    JSON.stringify(tool)
      .replaceAll('português do Brasil', 'inglês (US English)')
      .replaceAll('em português', 'em inglês'),
  ) as T;
}

export interface ReportNarrative {
  resumoExecutivo: string;
  /**
   * Seções em prosa — DERIVADAS dos tópicos quando a IA responde no formato
   * novo. Mantidas na interface para o fallback pdfkit (ReportPdfService).
   */
  secoes: Array<{ titulo: string; corpo: string }>;
  /**
   * Tópicos em caixas (layout bento do relatório HTML): título + tag curta +
   * bullets de 1 frase. Ausente em narrativas antigas/template — o HTML então
   * deriva as caixas a partir de `secoes`.
   */
  topicos?: Array<{ titulo: string; tag: string; bullets: string[] }>;
  /** Falas reais e marcantes do chat, para o card "Vozes do chat". */
  quotes?: Array<{ user: string; text: string }>;
}

const REPORT_TOOL = {
  name: 'gerar_relatorio',
  description:
    'Produz um relatório editorial em português do Brasil sobre uma transmissão ao vivo, ' +
    'para ser entregue a uma MARCA ou ao STREAMER. É um relatório DESCRITIVO e analítico ' +
    '(o que aconteceu e por quê), NÃO um documento de recomendações ou próximos passos. ' +
    'Estilo de data storytelling: cada afirmação ancorada num número, palavra-chave, marca ' +
    'ou fala real do chat presente nos dados.',
  input_schema: {
    type: 'object',
    properties: {
      resumo_executivo: {
        type: 'string',
        description:
          '2 a 4 frases que contam a história do período em números concretos: volume de ' +
          'mensagens, clima dominante (com o % real), e o momento ou pauta que mais marcou. ' +
          'Nada de generalidades — cite os valores fornecidos. ' +
          'MÁXIMO de 420 caracteres no total: o espaço no PDF é fixo e texto além disso é cortado.',
      },
      topicos: {
        type: 'array',
        description:
          'De 4 a 6 tópicos, cada um vira uma CAIXA no relatório (layout bento). ' +
          'Sugeridos: "Clima e sentimento", "Pautas do chat", "Destaques e momentos", ' +
          '"Menções a marcas", "Público e engajamento". ' +
          'PROIBIDO tópico ou bullet sobre toxicidade, moderação ou atritos entre usuários; ' +
          'esse tema não entra no relatório. ' +
          'REGRAS para os bullets (3 a 5 por tópico, 1 frase curta cada, máx ~140 chars): ' +
          '(1) cite números exatos dos dados (%, contagens, picos); ' +
          '(2) quando fizer sentido, referencie palavras-chave, marcas e falas reais ' +
          'da amostra do chat para ilustrar; ' +
          '(3) explique o que o dado significa, sem dar conselhos nem listar ações; ' +
          '(4) proibido bullet genérico que serviria para qualquer live.' +
          'Use SOMENTE os dados fornecidos; não invente fatos.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string' },
            tag: {
              type: 'string',
              description:
                'Etiqueta de 1 palavra, minúscula, ex.: sentimento, conversas, momentos, marcas, audiência.',
            },
            bullets: { type: 'array', items: { type: 'string' } },
          },
          required: ['titulo', 'tag', 'bullets'],
        },
      },
      citacoes: {
        type: 'array',
        description:
          '2 a 3 falas REAIS e marcantes da amostra do chat (copiadas literalmente, com o ' +
          'username do autor). Escolha as que melhor representam o clima do período. ' +
          'Se a amostra estiver vazia, retorne lista vazia.',
        items: {
          type: 'object',
          properties: {
            usuario: { type: 'string' },
            frase: { type: 'string' },
          },
          required: ['usuario', 'frase'],
        },
      },
    },
    required: ['resumo_executivo', 'topicos'],
  },
} as const;

export interface TopicsResult {
  labels: string[];
  resumo: string;
}

const TOPICS_TOOL = {
  name: 'descrever_assuntos',
  description:
    'Descreve os assuntos mais comentados no chat de uma live num período, em português do Brasil.',
  input_schema: {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        description: '3 a 8 rótulos CURTOS (1 a 3 palavras) dos assuntos mais pautados no chat.',
        items: { type: 'string' },
      },
      resumo: {
        type: 'string',
        description:
          '2 a 4 frases descrevendo os assuntos mais comentados e o tom do chat no período, baseado SOMENTE nos dados.',
      },
    },
    required: ['labels', 'resumo'],
  },
} as const;

/** Blocos de content da resposta Anthropic acessados neste service. */
interface AnthropicContentBlock {
  type?: string;
  name?: string;
  text?: string;
  input?: unknown;
}
interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
}
/** Status/resultado mínimos da Message Batches API usados aqui. */
interface AnthropicBatchLike {
  id: string;
  processing_status?: string;
}
interface AnthropicBatchResultEntry {
  custom_id?: string;
  result?: {
    type?: string;
    message?: AnthropicMessageResponse;
    error?: { type?: string; message?: string };
  };
}
interface AnthropicBatchesSurface {
  create(args: Record<string, unknown>): Promise<AnthropicBatchLike>;
  retrieve(id: string): Promise<AnthropicBatchLike>;
  cancel(id: string): Promise<unknown>;
  results(id: string): Promise<AsyncIterable<AnthropicBatchResultEntry>>;
}
/** Superfície mínima do client Anthropic usada aqui (lazy import do SDK). */
interface AnthropicClientLike {
  messages: {
    create(args: Record<string, unknown>): Promise<AnthropicMessageResponse>;
    batches?: AnthropicBatchesSurface;
  };
}

@Injectable()
export class ReportLlmService {
  private readonly logger = new Logger(ReportLlmService.name);
  private client: AnthropicClientLike | null = null;
  private readonly model: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.model = this.config.get<string>('LLM_MODEL_TIER2') ?? HAIKU_MODEL;
  }

  /** True quando a IA real está disponível (driver real + chave). */
  isAiEnabled(): boolean {
    const driver = this.config.get<string>('LLM_DRIVER') ?? 'mock';
    return driver === 'real' && Boolean(this.config.get<string>('ANTHROPIC_API_KEY'));
  }

  async generate(input: ReportLlmInput): Promise<ReportNarrative | null> {
    if (!this.isAiEnabled()) return null;
    try {
      const response = await this._createMessage(
        {
          model: this.model,
          max_tokens: 3000,
          system: buildReportSystemBlocks(
            'Você é um analista de comunidades de streaming que escreve relatórios ' +
              'executivos em português do Brasil para marcas e streamers, no estilo de um ' +
              'relatório de dados editorial (data storytelling). Cada frase relevante deve estar ' +
              'ancorada num número, palavra-chave, marca ou fala real presentes nos dados. ' +
              'Seja específico e analítico: descreva o que aconteceu e por quê. ' +
              'NÃO escreva recomendações, conselhos nem próximos passos. ' +
              'NÃO use frases genéricas que serviriam para qualquer live. ' +
              'Não invente fatos além dos dados fornecidos. ' +
              'Nunca use travessão (—) no texto; prefira vírgula, dois-pontos ou ponto final. ' +
              'Não cite horários de relógio (hh:mm, "às 14h41") no texto; situe momentos ' +
              'como "no pico" ou pelo dia.',
            input,
          ),
          tools: [localizedTool(REPORT_TOOL, input)],
          tool_choice: { type: 'tool', name: 'gerar_relatorio' },
          messages: [
            {
              role: 'user',
              content: withUserLanguage(
                `Gere o relatório da live do canal "${input.channelName}" com base nestes dados:\n\n` +
                  input.context,
                input,
              ),
            },
          ],
        },
        input.viaBatch === true,
      );

      const block = (response.content ?? []).find(
        (b: { type?: string; name?: string }) =>
          b.type === 'tool_use' && b.name === 'gerar_relatorio',
      );
      if (!block?.input) {
        this.logger.warn('Resposta Anthropic sem tool_use do relatório — usando template');
        return null;
      }
      const raw = block.input as Record<string, unknown>;
      // Defesa extra: mesmo proibido no prompt, descarta tópico de
      // toxicidade/moderação se a IA insistir — o relatório não cobre o tema.
      const toxRe = /toxic|modera|atrito/i;
      const topicos = (
        Array.isArray(raw['topicos'])
          ? (raw['topicos'] as Array<Record<string, unknown>>).map((t) => ({
              titulo: String(t['titulo'] ?? ''),
              tag: String(t['tag'] ?? ''),
              bullets: Array.isArray(t['bullets'])
                ? (t['bullets'] as unknown[]).map((b) => String(b)).filter(Boolean)
                : [],
            }))
          : []
      ).filter((t) => !toxRe.test(`${t.tag} ${t.titulo}`));
      const quotes = Array.isArray(raw['citacoes'])
        ? (raw['citacoes'] as Array<Record<string, unknown>>)
            .map((q) => ({ user: String(q['usuario'] ?? ''), text: String(q['frase'] ?? '') }))
            .filter((q) => q.text)
        : [];
      return {
        resumoExecutivo: String(raw['resumo_executivo'] ?? ''),
        // Prosa derivada dos bullets — mantém o fallback pdfkit funcionando.
        secoes: topicos.map((t) => ({ titulo: t.titulo, corpo: t.bullets.join(' ') })),
        topicos,
        quotes,
      };
    } catch (err) {
      this.logger.error(
        `Falha ao gerar relatório via IA: ${(err as Error).message} — usando template`,
      );
      return null;
    }
  }

  /**
   * "Assuntos do chat" — descreve via Haiku os assuntos mais pautados num
   * período. Retorna labels + resumo, ou null (fallback heurístico no caller).
   */
  async describeTopics(input: ReportLlmInput): Promise<TopicsResult | null> {
    if (!this.isAiEnabled()) return null;
    try {
      const response = await this._createMessage(
        {
          model: this.model,
          max_tokens: 700,
          system: buildReportSystemBlocks(
            'Você analisa o chat de lives de streaming e resume, em português do Brasil, ' +
              'os assuntos mais comentados. Use só os dados fornecidos, não invente. ' +
              'Nunca use travessão (—) no texto; prefira vírgula, dois-pontos ou ponto final.',
            input,
          ),
          tools: [localizedTool(TOPICS_TOOL, input)],
          tool_choice: { type: 'tool', name: 'descrever_assuntos' },
          messages: [
            {
              role: 'user',
              content: withUserLanguage(
                `Descreva os assuntos mais comentados no chat do canal "${input.channelName}" ` +
                  `com base nestes dados:\n\n${input.context}`,
                input,
              ),
            },
          ],
        },
        input.viaBatch === true,
      );
      const block = (response.content ?? []).find(
        (b: { type?: string; name?: string }) =>
          b.type === 'tool_use' && b.name === 'descrever_assuntos',
      );
      if (!block?.input) return null;
      const raw = block.input as Record<string, unknown>;
      return {
        labels: Array.isArray(raw['labels'])
          ? (raw['labels'] as unknown[]).map((l) => String(l)).slice(0, 8)
          : [],
        resumo: String(raw['resumo'] ?? ''),
      };
    } catch (err) {
      this.logger.error(`Falha ao descrever assuntos via IA: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Insight curto sob demanda (ex.: clicar num bloco de mensagens do feed).
   * Texto livre em pt-BR (2-4 frases). Null sem IA → fallback no caller.
   */
  async quickInsight(input: ReportLlmInput): Promise<string | null> {
    if (!this.isAiEnabled()) return null;
    try {
      const response = await this._createMessage(
        {
          model: this.model,
          max_tokens: 400,
          system: buildReportSystemBlocks(
            'Você analisa blocos de chat de lives e devolve um insight curto e ' +
              'acionável em português do Brasil (2 a 4 frases). Use só os dados dados, não invente. ' +
              'Nunca use travessão (—) no texto; prefira vírgula, dois-pontos ou ponto final. ' +
              'Não cite horários de relógio (hh:mm) no texto.',
            input,
          ),
          messages: [
            {
              role: 'user',
              content: withUserLanguage(
                `Gere um insight curto sobre este bloco de mensagens do chat do canal "${input.channelName}":\n\n${input.context}`,
                input,
              ),
            },
          ],
        },
        input.viaBatch === true,
      );
      const text = (response.content ?? [])
        .filter((b: { type?: string }) => b.type === 'text')
        .map((b: { text?: string }) => b.text ?? '')
        .join('\n')
        .trim();
      return text || null;
    } catch (err) {
      this.logger.error(`Falha no quickInsight via IA: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Executa a chamada: sync por padrão; via Message Batches API (−50%/token)
   * quando o caller pediu (`viaBatch`) E a env `LLM_BATCH_API=true`.
   * Qualquer falha/timeout do batch cai na chamada sync — o relatório nunca
   * deixa de sair por causa do caminho barato.
   */
  private async _createMessage(
    params: Record<string, unknown>,
    viaBatch: boolean,
  ): Promise<AnthropicMessageResponse> {
    const client = await this._getClient();
    if (viaBatch && this._batchApiEnabled()) {
      try {
        return await this._createViaBatch(client, params);
      } catch (err) {
        this.logger.warn(
          `Message Batches falhou (${(err as Error).message}) — caindo para chamada sync`,
        );
      }
    }
    return client.messages.create(params);
  }

  private _batchApiEnabled(): boolean {
    return (this.config.get<string>('LLM_BATCH_API') ?? 'false') === 'true';
  }

  /**
   * Batch de 1 request: create → poll até `ended` (com teto) → primeiro
   * resultado. No timeout tenta cancelar o batch (pra não pagar por um
   * resultado que ninguém vai ler) e lança — o caller decide o fallback.
   */
  private async _createViaBatch(
    client: AnthropicClientLike,
    params: Record<string, unknown>,
  ): Promise<AnthropicMessageResponse> {
    const batches = client.messages.batches;
    if (!batches) throw new Error('SDK sem suporte a message batches');
    const timeoutMs = Number(this.config.get('LLM_BATCH_TIMEOUT_MS') ?? DEFAULT_BATCH_TIMEOUT_MS);
    const pollMs = Number(this.config.get('LLM_BATCH_POLL_MS') ?? DEFAULT_BATCH_POLL_MS);

    const started = Date.now();
    const batch = await batches.create({ requests: [{ custom_id: 'r0', params }] });
    let status = batch;
    while (status.processing_status !== 'ended') {
      if (Date.now() - started >= timeoutMs) {
        await batches.cancel(batch.id).catch(() => undefined);
        throw new Error(`batch ${batch.id} não terminou em ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
      status = await batches.retrieve(batch.id);
    }

    const results = await batches.results(batch.id);
    for await (const entry of results) {
      if (entry.result?.type === 'succeeded' && entry.result.message) {
        this.logger.log(
          `relatório via Message Batches ok (batch=${batch.id}, ${Date.now() - started}ms)`,
        );
        return entry.result.message;
      }
      throw new Error(
        `batch result ${entry.result?.type ?? 'desconhecido'}: ${entry.result?.error?.message ?? ''}`,
      );
    }
    throw new Error(`batch ${batch.id} terminou sem resultados`);
  }

  private async _getClient(): Promise<AnthropicClientLike> {
    if (this.client) return this.client;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = (mod as { default?: unknown }).default ?? mod;
    // @ts-expect-error — SDK runtime
    this.client = new Anthropic({ apiKey });
    return this.client!;
  }
}
