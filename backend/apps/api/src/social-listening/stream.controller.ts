/**
 * SSE controller — GET /api/v2/social-listening/stream/:channelId
 *
 * Cliente assina (EventSource ou fetch-event-source) e recebe um payload
 * `BatchAnalysis` JSON cada vez que o orchestrator publica em
 * `analysis:<channelId>` no Redis pub/sub.
 *
 * Auth:
 *  - Header `Authorization: Bearer <jwt>` (preferido — fetch-event-source)
 *  - Query `?token=<jwt>` (fallback — EventSource nativo do navegador
 *    não passa headers customizados)
 *
 * Heartbeat: comentário SSE `:ping` a cada 20s para manter a conexão viva.
 */
import {
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Query,
  Req,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable, Subject, interval, merge, map } from 'rxjs';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { EVENT_BUS_TOKEN, type EventBus, type Unsubscribe } from '@sehloro/domain';
import { Public } from '../identity/auth/decorators/public.decorator';
import type { BatchAnalysis } from './batch-analysis.types';
import { INSIGHT_CHANNEL_PREFIX } from './publish-insight.service';
import { LiveChatService, type LiveChatMessage } from './live-chat.service';

interface JwtPayload {
  userId: string;
  username: string;
  email: string;
  role: string;
}

interface SseMessage {
  data: BatchAnalysis | { ping: number };
}

interface ChatSseMessage {
  data: LiveChatMessage | { ping: number };
}

@Controller('v2/social-listening/stream')
@Public() // valida manualmente via header OU query
export class StreamController {
  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly jwt: JwtService,
    private readonly liveChat: LiveChatService,
  ) {}

  /**
   * Feed de chat CRU, em tempo real — GET /stream/:channelId/chat
   *
   * Emite um `LiveChatMessage` por mensagem assim que ela entra no bus,
   * sem esperar o batch. Ao conectar, faz backfill das últimas mensagens do
   * buffer (TTL 60s). Não filtra nada: é o chat inteiro, como na Twitch.
   */
  @Sse(':channelId/chat')
  liveChatStream(
    @Param('channelId') channelId: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
  ): Observable<ChatSseMessage> {
    this._assertAuth(req, queryToken);

    const events$ = new Subject<ChatSseMessage>();
    let unsub: Unsubscribe | null = null;
    let closed = false;

    void (async () => {
      // 1. backfill (não bloqueia o stream ao vivo se falhar)
      try {
        const recent = await this.liveChat.recent(channelId);
        if (!closed) for (const m of recent) events$.next({ data: m });
      } catch {
        /* buffer indisponível — segue só com o ao vivo */
      }
      if (closed) return;
      // 2. stream ao vivo
      try {
        const u = await this.liveChat.subscribe(channelId, (m) => events$.next({ data: m }));
        if (closed) Promise.resolve(u()).catch(() => undefined);
        else unsub = u;
      } catch (err) {
        events$.error(err);
      }
    })();

    const heartbeat$ = interval(20_000).pipe(
      map(() => ({ data: { ping: Date.now() } }) as ChatSseMessage),
    );

    return new Observable<ChatSseMessage>((subscriber) => {
      const sub = merge(events$, heartbeat$).subscribe(subscriber);
      return () => {
        closed = true;
        sub.unsubscribe();
        if (unsub) Promise.resolve(unsub()).catch(() => undefined);
      };
    });
  }

  @Sse(':channelId')
  stream(
    @Param('channelId') channelId: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
  ): Observable<SseMessage> {
    this._assertAuth(req, queryToken);

    const channel = INSIGHT_CHANNEL_PREFIX + channelId;
    const events$ = new Subject<SseMessage>();
    let unsub: Unsubscribe | null = null;

    // subscribe sem await — fica pendurado até o cliente fechar
    this.bus
      .subscribe<BatchAnalysis>(channel, (b) => events$.next({ data: b }))
      .then((u) => {
        unsub = u;
      })
      .catch((err) => events$.error(err));

    const heartbeat$ = interval(20_000).pipe(
      map(() => ({ data: { ping: Date.now() } }) as SseMessage),
    );

    return new Observable<SseMessage>((subscriber) => {
      const sub = merge(events$, heartbeat$).subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        if (unsub) {
          Promise.resolve(unsub()).catch(() => undefined);
        }
      };
    });
  }

  private _assertAuth(req: Request, queryToken: string | undefined): void {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer ?? queryToken;
    if (!token) throw new UnauthorizedException('Token não fornecido');
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      // Para SSE não filtramos por canal — o produto considera que
      // qualquer usuário autenticado pode assistir. Admin/mod/etc é
      // gate-keeping de WRITE; READ é mais aberto.
      void payload;
    } catch {
      throw new ForbiddenException('Token inválido');
    }
  }
}
