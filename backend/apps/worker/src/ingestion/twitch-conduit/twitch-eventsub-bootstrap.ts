/**
 * Boot do shard receiver Twitch EventSub no worker.
 *
 * Sequência em onApplicationBootstrap:
 *  1. TwitchConduitService.ensureConduit() — cria ou reaproveita o conduit
 *     singleton no Helix.
 *  2. Instancia TwitchEventSubWsClient passando o bridge como handler.
 *  3. onWelcome do client recebe o session_id; usamos para
 *     TwitchConduitService.assignShards e ligar este shard #0 ao conduit.
 *  4. A partir daí, notifications fluem para o bridge automaticamente.
 *
 * onApplicationShutdown fecha o WS sem reconnect.
 */
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import WebSocket from 'ws';
import { TwitchConduitService } from '@sehloro/infra';
import { TwitchEventSubBridge } from './twitch-eventsub-bridge';
import { TwitchEventSubWsClient, WsLike } from './twitch-eventsub-ws.client';

const SHARD_ID = '0';

@Injectable()
export class TwitchEventSubBootstrap implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TwitchEventSubBootstrap.name);
  private client: TwitchEventSubWsClient | null = null;

  constructor(
    private readonly conduit: TwitchConduitService,
    private readonly bridge: TwitchEventSubBridge,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { conduitId } = await this.conduit.ensureConduit();
    this.logger.log(`Conduit ativo: ${conduitId} — abrindo shard ${SHARD_ID}`);

    this.client = new TwitchEventSubWsClient(
      {
        onWelcome: async (sessionId) => {
          await this.conduit.assignShards(conduitId, [
            { id: SHARD_ID, transport: { method: 'websocket', session_id: sessionId } },
          ]);
          this.logger.log(
            `Shard ${SHARD_ID} atribuído ao conduit ${conduitId} (session ${sessionId})`,
          );
        },
        onNotification: (payload) => {
          this.bridge
            .handleNotification(payload)
            .catch((err) =>
              this.logger.error('Bridge.handleNotification falhou', (err as Error).stack),
            );
        },
        onRevocation: (payload) => {
          this.bridge
            .handleRevocation(payload)
            .catch((err) =>
              this.logger.error('Bridge.handleRevocation falhou', (err as Error).stack),
            );
        },
        onKeepalive: () => {
          // espaço pra métrica em telemetria futura
        },
      },
      (url) => new WebSocket(url) as unknown as WsLike,
    );
    this.client.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.client?.close();
    this.client = null;
  }
}
