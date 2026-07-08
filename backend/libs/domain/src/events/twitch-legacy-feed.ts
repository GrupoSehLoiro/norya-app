/**
 * Cross-process event contract para EventSub topics que alimentam as
 * collections legadas (Fase 5: conduit → legacy).
 *
 * Publishers: worker (`TwitchEventSubBridge`) ao receber notification.
 * Subscribers: API (`apps/api/src/legacy/event-handlers/*`) gravando nos
 * Mongoose models (`Ban`, `Timeout`, `MessageDeleted`, `Poll`, `Prediction`,
 * `ChatEmoji`).
 *
 * Strings dos channels são keys do Redis pub/sub — NÃO REFATORAR sem
 * coordenar publisher e subscriber.
 */

export const TWITCH_CHANNEL_BAN_CHANNEL = 'twitch.channel.ban';
export const TWITCH_CHANNEL_MESSAGE_DELETE_CHANNEL = 'twitch.channel.message.delete';
export const TWITCH_CHANNEL_POLL_END_CHANNEL = 'twitch.channel.poll.end';
export const TWITCH_CHANNEL_PREDICTION_END_CHANNEL = 'twitch.channel.prediction.end';
/**
 * Channel onde o worker publica RawMessage normalizado a partir de
 * `channel.chat.message`. Definido também em
 * `apps/worker/src/ingestion/twitch-conduit/twitch-eventsub-bridge.ts`
 * — manter os dois em sincronia (mesma string).
 */
export const CHAT_MESSAGE_BUS_CHANNEL = 'chat.message';

/**
 * `channel.ban` EventSub representa tanto ban permanente quanto timeout.
 * Distinção: `isPermanent === true` → ban; `false` + `endsAt` definido →
 * timeout (`tempoDeTO = endsAt - now`, em segundos).
 */
export interface TwitchChannelBanPayload {
  channelExternalId: string;
  broadcasterUserLogin: string;
  userExternalId: string;
  userLogin: string;
  moderatorUserLogin: string;
  reason: string;
  isPermanent: boolean;
  bannedAt: string;
  /** ISO ou null quando isPermanent=true. */
  endsAt: string | null;
}

export interface TwitchChannelMessageDeletePayload {
  channelExternalId: string;
  broadcasterUserLogin: string;
  targetUserLogin: string;
  messageId: string;
  messageBody: string;
  observedAt: string;
}

export interface TwitchChannelPollEndPayload {
  channelExternalId: string;
  broadcasterUserLogin: string;
  pollId: string;
  title: string;
  startedAt: string;
  endedAt: string;
  status: string;
  choices: Array<{
    id: string;
    title: string;
    votes: number;
    channelPointsVotes: number;
    bitsVotes: number;
  }>;
  bitsVotingEnabled: boolean;
  bitsPerVote: number;
  channelPointsVotingEnabled: boolean;
  channelPointsPerVote: number;
}

export interface TwitchChannelPredictionEndPayload {
  channelExternalId: string;
  broadcasterUserLogin: string;
  predictionId: string;
  title: string;
  winningOutcomeId: string | null;
  createdAt: string;
  endedAt: string;
  lockedAt: string | null;
  outcomes: Array<{
    id: string;
    title: string;
    totalChannelPoints: number;
    users: number;
    topPredictors: Array<{ userLogin: string; channelPointsUsed: number }>;
  }>;
}
