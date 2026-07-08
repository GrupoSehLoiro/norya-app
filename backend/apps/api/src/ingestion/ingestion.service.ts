import { Injectable } from '@nestjs/common';

/**
 * Bounded context: Ingestion.
 *
 * Ponto de entrada dos eventos vindos dos bots Twitch/Kick (chat, bans,
 * predictions, polls). No alvo arquitetural grava em ClickHouse; no M1
 * ainda escreve em Mongo para manter compatibilidade com o legado.
 */
@Injectable()
export class IngestionService {}
