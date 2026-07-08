/**
 * Tool definitions para Anthropic tool use (M4 LLM-04).
 * Forçar `tool_choice: { type:'tool', name:'classify_batch' }` garante
 * output JSON-válido sem retry de parse.
 */
export const CLASSIFY_BATCH_TOOL = {
  name: 'classify_batch',
  description:
    'Classifica sentimento agregado, top categorias, top usuários tóxicos, marcas mencionadas e sentimento do AD (se ativo).',
  input_schema: {
    type: 'object',
    properties: {
      sentiment: {
        type: 'object',
        properties: {
          pos: { type: 'number', minimum: 0, maximum: 1 },
          neg: { type: 'number', minimum: 0, maximum: 1 },
          neu: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['pos', 'neg', 'neu'],
      },
      top_categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            count: { type: 'integer', minimum: 0 },
          },
          required: ['category', 'count'],
        },
        maxItems: 10,
      },
      top_toxic_users: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            ratio: { type: 'number', minimum: 0, maximum: 1 },
            msg_count: { type: 'integer', minimum: 1 },
          },
          required: ['username', 'ratio', 'msg_count'],
        },
        maxItems: 5,
      },
      least_toxic_user: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              username: { type: 'string' },
              ratio: { type: 'number', minimum: 0, maximum: 1 },
              msg_count: { type: 'integer', minimum: 1 },
            },
            required: ['username', 'ratio', 'msg_count'],
          },
        ],
      },
      mentioned_brands: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            brand: { type: 'string' },
            count: { type: 'integer', minimum: 0 },
          },
          required: ['brand', 'count'],
        },
        maxItems: 10,
      },
      ad_sentiment: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            properties: {
              pos: { type: 'number', minimum: 0, maximum: 1 },
              neg: { type: 'number', minimum: 0, maximum: 1 },
              neu: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['pos', 'neg', 'neu'],
          },
        ],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      needs_escalation: { type: 'boolean' },
      reasoning: { type: 'string', maxLength: 400 },
      dominant_category_context: {
        type: 'string',
        maxLength: 160,
        description:
          'Frase curta (pt-BR, máx ~140 caracteres) explicando o CONTEXTO da pauta/categoria mais comentada: o que o chat está falando sobre ela e por quê. Específico desta janela, não genérico.',
      },
    },
    required: [
      'sentiment',
      'top_categories',
      'top_toxic_users',
      'mentioned_brands',
      'confidence',
      'needs_escalation',
      'dominant_category_context',
    ],
  },
} as const;
