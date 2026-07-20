import { z } from 'zod';

/**
 * Schema canônico de configuração do backend SEHLORO/SLMOD.
 *
 * Vive em @sehloro/infra (e não em @sehloro/domain) porque o mapeamento
 * env -> config é preocupação de infraestrutura, não de negócio. Ambas as
 * aplicações (apps/api e apps/worker) importam daqui para garantir que
 * validam contra exatamente o mesmo contrato.
 */

/**
 * Helper de validação: confirma que a string é base64 que decodifica
 * para EXATAMENTE 32 bytes (256 bits), o tamanho canônico para AES-256.
 * Usado tanto na chave corrente (aqui no Zod, fail-fast) como nas chaves
 * anteriores de rotação (parse tolerante no CryptoService).
 */
function isBase64Key32Bytes(s: string): boolean {
  try {
    const b = Buffer.from(s, 'base64');
    return b.length === 32;
  } catch {
    return false;
  }
}

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI não pode ser vazio'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter no mínimo 32 caracteres'),

  // TTL do access token. Aceita strings do jsonwebtoken (ex.: '15m', '1h',
  // '30s'). Não convertemos para número aqui porque o @nestjs/jwt consome
  // diretamente esse formato.
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),

  // TTL do refresh token, em dias inteiros. Coerção explícita porque env vars
  // chegam sempre como string.
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),

  REDIS_URL: z.string().optional(),

  /**
   * ClickHouse — banco analítico (M4 IA core).
   *
   * Os 4 são opcionais aqui no schema base para não quebrar apps que
   * não usam analytics (workers de ingest puro). O AnalyticsModule
   * exige os 4 quando é importado via `forRootAsync` e falha o boot
   * se algum estiver vazio.
   */
  CLICKHOUSE_URL: z.string().optional(),
  CLICKHOUSE_USER: z.string().optional(),
  CLICKHOUSE_PASSWORD: z.string().optional(),
  CLICKHOUSE_DB: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),

  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  TWITCH_WEBHOOK_SECRET: z.string().min(10).optional(),
  TWITCH_CONDUIT_SHARD_COUNT: z.coerce.number().int().positive().optional(),
  /** user_id da conta de bot que vai ler chat em channel.chat.message subscriptions. */
  TWITCH_BOT_USER_ID: z.string().optional(),
  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),

  CORS_ORIGIN: z.string().optional(),

  /**
   * URL pública da API (usada pra montar redirect_uri do OAuth).
   * Default = http://localhost:8080 (nginx do compose).
   * Em prod aponta pro host real (incluindo o esquema https://).
   */
  PUBLIC_API_URL: z.string().optional(),
  /** URL pública do console Next — usada pra redirect pós-OAuth. */
  CONSOLE_URL: z.string().optional(),

  // ── Social-listening orchestrator (M4) ────────────────────────────────
  /** CSV de canalIds que o orchestrator processa. Vazio = só auto-discovery. */
  SOCIAL_LISTENING_CHANNELS: z.string().optional(),
  /** Intervalo entre ticks de avaliação do orchestrator. Default 15000. */
  SOCIAL_LISTENING_TICK_MS: z.coerce.number().int().positive().optional(),
  /** Tamanho default da janela cronológica (fallback se buffer vazio). */
  SOCIAL_LISTENING_WINDOW_MS: z.coerce.number().int().positive().optional(),
  /**
   * Gap mínimo de silêncio (ms sem msgs novas) pra "fechar" a rajada
   * e drenar o buffer. Default 4000.
   */
  SOCIAL_LISTENING_IDLE_GAP_MS: z.coerce.number().int().nonnegative().optional(),
  /**
   * Janela máxima absoluta — força drain mesmo se ainda houver atividade
   * pra evitar buffer represado pra sempre. Default 60000.
   */
  SOCIAL_LISTENING_MAX_WINDOW_MS: z.coerce.number().int().positive().optional(),
  /** Driver do LLM: mock | real | fallback. Default mock. */
  LLM_DRIVER: z.enum(['mock', 'real', 'fallback']).optional(),
  /** Driver do EventBus: memory | redis. Default redis se REDIS_URL setado. */
  EVENT_BUS_DRIVER: z.enum(['memory', 'redis']).optional(),

  // ── Página/endpoint de logs (GET /api/v2/logs) ─────────────────────────
  /**
   * Credencial de Basic Auth do endpoint de access logs. Os DOIS precisam
   * estar setados para o endpoint existir; sem eles responde 404. Credencial
   * operacional, separada do JWT do produto de propósito.
   */
  LOGS_USER: z.string().optional(),
  LOGS_PASSWORD: z.string().min(12, 'LOGS_PASSWORD precisa de no mínimo 12 caracteres').optional(),

  // ── Bootstrap do primeiro admin (gestão de acesso) ─────────────────────
  /**
   * Se AMBOS setados, o boot garante que esse usuário exista com role=admin
   * (cria ativo/verificado se não existir; se existir, não toca). Demais
   * admins são criados pela página de gestão de acesso, por outro admin.
   */
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z
    .string()
    .min(12, 'INITIAL_ADMIN_PASSWORD precisa de no mínimo 12 caracteres')
    .optional(),

  // ── Email (verificação de email no sign-up) — Fase 1 ──────────────────
  /** Driver de email: log (default) | resend (API) | smtp (nodemailer). */
  EMAIL_DRIVER: z.enum(['log', 'resend', 'smtp']).optional(),
  /** API key do Resend (exigida quando EMAIL_DRIVER=resend). */
  RESEND_API_KEY: z.string().optional(),
  /** SMTP (EMAIL_DRIVER=smtp) — ex.: Mailpit local em localhost:1025. */
  SMTP_HOST: z.string().optional(),
  // O compose injeta `${SMTP_PORT:-}` → a var chega como STRING VAZIA quando
  // não está no .env; `.optional()` só cobre undefined e `coerce` faria ""→0.
  // Trata vazio como ausente pra não derrubar o boot de quem não usa SMTP.
  SMTP_PORT: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Remetente dos emails. Ex.: 'SEHLORO <no-reply@sehloro.dev>'. */
  MAIL_FROM: z.string().optional(),
  /** TTL do código de verificação em minutos. Default 15. */
  EMAIL_CODE_TTL_MIN: z.coerce.number().int().positive().optional(),

  /**
   * Chave mestre para envelope-encryption AES-256-GCM de tokens OAuth (AUTH-02).
   * OBRIGATÓRIA — a API não sobe sem ela. Formato: base64 de 32 bytes exatos.
   * Gere com: `openssl rand -base64 32`.
   */
  CRYPTO_MASTER_KEY: z
    .string({ required_error: 'CRYPTO_MASTER_KEY é obrigatória para o envelope de tokens OAuth' })
    .refine(
      isBase64Key32Bytes,
      'CRYPTO_MASTER_KEY deve ser base64 de 32 bytes (gere com `openssl rand -base64 32`)',
    ),

  /**
   * Chaves anteriores para decripts durante rotação. CSV de base64.
   * OPCIONAL. O parse tolerante (entradas inválidas são ignoradas com warn)
   * fica no CryptoService — aqui só aceitamos qualquer string não-vazia.
   * A chave CORRENTE nunca entra aqui, apenas as anteriores.
   */
  CRYPTO_PREV_KEYS: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Plugável no `ConfigModule.forRoot({ validate })`.
 * Converte ZodError numa mensagem multi-linha e relança para fail-fast do Nest.
 */
export function zodValidate(raw: Record<string, unknown>): AppConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Falha na validação de variáveis de ambiente (Zod):\n${issues}\n` +
        `Veja backend/.env.example para o conjunto esperado.`,
    );
  }
  return parsed.data;
}
