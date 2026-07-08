/**
 * CHAT-01 · Port (interface) ChatProvider.
 *
 * Abstração agnóstica de plataforma para qualquer provedor de chat
 * (Twitch IRC, Twitch Conduit, Kick Pusher, mock de testes).
 *
 * Invariantes:
 * - Handlers registrados via onMessage/onLifecycle são síncronos; nunca
 *   lançar exceções nem retornar Promise dentro deles.
 * - Mensagens chegam com `emotes` sempre preenchido (array vazio se ausente).
 * - Nunca emitir `undefined` para os handlers.
 * - O unsubscribe retornado é idempotente (chamar N vezes é seguro).
 * - `disconnect()` é idempotente — chamar em estado já desconectado não lança.
 * - `getViewerCount()` nunca lança — retorna `null` se não suportado.
 */
import { RawMessage } from './raw-message';

export type LifecycleEvent = {
  type: 'connected' | 'disconnected' | 'reconnecting' | 'rate_limited' | 'message_deleted';
  ts: Date;
  reason?: string;
  /** Preenchido em type='message_deleted': ID da mensagem removida. */
  targetMessageId?: string;
};

export interface ChatProviderConfig {
  platform: 'twitch' | 'kick';
  channelExternalId: string;
  channelName: string;
  credentials: Record<string, string>;
}

export interface ChatProvider {
  /** Conecta ao canal. Emite lifecycle 'connected' quando estabelecido. */
  connect(): Promise<void>;

  /** Desconecta. Idempotente. Emite lifecycle 'disconnected'. */
  disconnect(): Promise<void>;

  /**
   * Registra handler de mensagens. Retorna função de unsubscribe.
   * Pode ser chamado antes de connect(); mensagens só chegam pós-connect.
   */
  onMessage(handler: (msg: RawMessage) => void): () => void;

  /**
   * Registra handler de eventos de ciclo de vida (conectado, desconectado,
   * reconectando, rate_limited). Retorna função de unsubscribe.
   */
  onLifecycle(handler: (evt: LifecycleEvent) => void): () => void;

  /**
   * Viewer count em tempo real.
   * Retorna `null` se a plataforma/implementação não suporta.
   */
  getViewerCount(): Promise<number | null>;

  /**
   * Health check interno.
   * `alive: false` se não conectado ou sem receber mensagens além do timeout.
   */
  healthz(): Promise<{
    alive: boolean;
    lastMessageAt?: Date;
    details?: Record<string, unknown>;
  }>;
}
