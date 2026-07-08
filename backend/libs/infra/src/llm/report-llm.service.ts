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
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export interface ReportLlmInput {
  /** Texto já serializado com período, métricas agregadas e amostra de msgs. */
  context: string;
  /** Nome do canal/streamer para personalizar o tom. */
  channelName: string;
}

export interface ReportNarrative {
  resumoExecutivo: string;
  secoes: Array<{ titulo: string; corpo: string }>;
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
          'Nada de generalidades — cite os valores fornecidos.',
      },
      secoes: {
        type: 'array',
        description:
          'De 4 a 6 seções densas. Sugeridas: "Clima e sentimento", "Pautas do chat", ' +
          '"Destaques e momentos", "Menções a marcas", "Público e engajamento", ' +
          '"Moderação e atritos". REGRAS para o corpo de cada seção (2 a 4 parágrafos): ' +
          '(1) cite números exatos dos dados (%, contagens, picos); ' +
          '(2) quando fizer sentido, parafraseie ou referencie palavras-chave, marcas e ' +
          'falas reais da amostra do chat para ilustrar; ' +
          '(3) explique o que o dado significa, sem dar conselhos nem listar ações; ' +
          '(4) proibido frase de enchimento genérica que serviria para qualquer live. ' +
          'Use SOMENTE os dados fornecidos; não invente fatos.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string' },
            corpo: { type: 'string' },
          },
          required: ['titulo', 'corpo'],
        },
      },
    },
    required: ['resumo_executivo', 'secoes'],
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
/** Superfície mínima do client Anthropic usada aqui (lazy import do SDK). */
interface AnthropicClientLike {
  messages: { create(args: Record<string, unknown>): Promise<AnthropicMessageResponse> };
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
      const client = await this._getClient();
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 3000,
        system:
          'Você é um analista de comunidades de streaming que escreve relatórios ' +
          'executivos em português do Brasil para marcas e streamers, no estilo de um ' +
          'relatório de dados editorial (data storytelling). Cada frase relevante deve estar ' +
          'ancorada num número, palavra-chave, marca ou fala real presentes nos dados. ' +
          'Seja específico e analítico: descreva o que aconteceu e por quê. ' +
          'NÃO escreva recomendações, conselhos nem próximos passos. ' +
          'NÃO use frases genéricas que serviriam para qualquer live. ' +
          'Não invente fatos além dos dados fornecidos.',
        tools: [REPORT_TOOL],
        tool_choice: { type: 'tool', name: 'gerar_relatorio' },
        messages: [
          {
            role: 'user',
            content:
              `Gere o relatório da live do canal "${input.channelName}" com base nestes dados:\n\n` +
              input.context,
          },
        ],
      });

      const block = (response.content ?? []).find(
        (b: { type?: string; name?: string }) =>
          b.type === 'tool_use' && b.name === 'gerar_relatorio',
      );
      if (!block?.input) {
        this.logger.warn('Resposta Anthropic sem tool_use do relatório — usando template');
        return null;
      }
      const raw = block.input as Record<string, unknown>;
      return {
        resumoExecutivo: String(raw['resumo_executivo'] ?? ''),
        secoes: Array.isArray(raw['secoes'])
          ? (raw['secoes'] as Array<Record<string, unknown>>).map((s) => ({
              titulo: String(s['titulo'] ?? ''),
              corpo: String(s['corpo'] ?? ''),
            }))
          : [],
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
      const client = await this._getClient();
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 700,
        system:
          'Você analisa o chat de lives de streaming e resume, em português do Brasil, ' +
          'os assuntos mais comentados. Use só os dados fornecidos, não invente.',
        tools: [TOPICS_TOOL],
        tool_choice: { type: 'tool', name: 'descrever_assuntos' },
        messages: [
          {
            role: 'user',
            content:
              `Descreva os assuntos mais comentados no chat do canal "${input.channelName}" ` +
              `com base nestes dados:\n\n${input.context}`,
          },
        ],
      });
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
      const client = await this._getClient();
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 400,
        system:
          'Você analisa blocos de chat de lives e devolve um insight curto e ' +
          'acionável em português do Brasil (2 a 4 frases). Use só os dados dados, não invente.',
        messages: [
          {
            role: 'user',
            content: `Gere um insight curto sobre este bloco de mensagens do chat do canal "${input.channelName}":\n\n${input.context}`,
          },
        ],
      });
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
