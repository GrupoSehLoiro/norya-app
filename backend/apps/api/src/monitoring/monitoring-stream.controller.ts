/**
 * SSE controller — GET /api/v2/monitoring/stream
 *
 * Stream em tempo real dos eventos de ciclo de vida de LiveSession
 * (LiveSessionStarted / LiveSessionEnded) publicados por MonitoringService
 * no canal `monitoring.live-session` do event bus. O console assina UMA vez
 * (global, no layout) e atualiza o cache do React Query instantaneamente —
 * substituindo o polling de 10s do status on/off do canal.
 *
 * Diferente do StreamController de social-listening, NÃO é por canal: emite
 * todos os eventos de sessão e o cliente filtra por `channelId`. Assim uma
 * única conexão SSE cobre o picker inteiro (perf: 1 conexão, não N).
 *
 * Auth (igual ao stream de insights):
 *  - Header `Authorization: Bearer <jwt>` (fetch-event-source)
 *  - Query `?token=<jwt>` (fallback EventSource nativo)
 *
 * Heartbeat: `:ping` a cada 20s pra manter a conexão viva atrás de proxies.
 */
import {
  Controller,
  ForbiddenException,
  Inject,
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
import { DOMAIN_EVENT_CHANNEL } from './monitoring.service';

interface JwtPayload {
  userId: string;
  username: string;
  email: string;
  role: string;
}

interface SseMessage {
  data: unknown;
}

@Controller('v2/monitoring/stream')
@Public() // valida manualmente via header OU query
export class MonitoringStreamController {
  constructor(
    @Inject(EVENT_BUS_TOKEN) private readonly bus: EventBus,
    private readonly jwt: JwtService,
  ) {}

  @Sse()
  stream(
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
  ): Observable<SseMessage> {
    this._assertAuth(req, queryToken);

    const events$ = new Subject<SseMessage>();
    let unsub: Unsubscribe | null = null;

    this.bus
      .subscribe<unknown>(DOMAIN_EVENT_CHANNEL, (event) => events$.next({ data: event }))
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
      void payload;
    } catch {
      throw new ForbiddenException('Token inválido');
    }
  }
}
