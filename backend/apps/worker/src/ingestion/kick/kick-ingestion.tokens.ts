/**
 * Tokens de DI da ingestão Kick no worker.
 *
 * O `KICK_PROVIDER_CREATOR` desacopla o KickIngestionService da construção
 * concreta do KickPusherProvider — em produção cria o provider real (Pusher),
 * nos testes injetamos um MockChatProvider e emitimos mensagens à mão.
 */
import type { Channel, ChatProvider } from '@sehloro/domain';

/** Cria um ChatProvider para um canal Kick já com o chatroomId resolvido. */
export type KickProviderCreator = (channel: Channel, chatroomId: string) => ChatProvider;

export const KICK_PROVIDER_CREATOR = Symbol('KickProviderCreator');
