# Sehloro Console

Console operacional **Next.js 14** (App Router) para o backend SEHLORO/SLMOD
(M4 IA Core). Repositório **separado** do monorepo principal — comunica-se
apenas via HTTP/SSE.

## O que está aqui

Front prototipo funcional que mostra o backend e o pipeline M4 em
funcionamento de verdade, consumindo:

- `POST /api/users/login` (legacy Express) — login JWT
- `GET /api/v2/channels`, `POST /api/v2/channels` — canais
- `GET /api/v2/monitoring/sessions` — sessões ao vivo
- `GET /api/v2/feature-flags` + `PATCH /:key` — admin
- `POST /api/v2/social-listening/ad/{start,stop}`, `GET /ad/active` — controle de AD
- `GET|POST|DELETE /api/v2/social-listening/brands` — allowlist por canal
- `GET /api/v2/social-listening/insights/{latest,history}` — REST polling
- `GET /api/v2/social-listening/stream/:channelId` — **SSE live feed**

## Stack

- Next.js 14 (App Router) + React 18
- TypeScript strict (`noUncheckedIndexedAccess`)
- TailwindCSS
- TanStack React Query 5 (cache + polling)
- @microsoft/fetch-event-source (SSE com header `Authorization`)
- react-hook-form + zod (forms)
- vitest + @testing-library (testes)

## Pages

```
/                              → redirect baseado em auth
/login                         → email + senha
/register                      → admin cria conta
/dashboard                     → visão geral (channels, sessions, flags counts)
/dashboard/insights            → 7 insights ao vivo + SSE + histórico
/dashboard/insights/[channelId]→ vista detalhada por canal
/dashboard/channels            → CRUD básico de canais v2
/dashboard/brands              → allowlist de marcas por canal
/dashboard/ad-control          → toggle manual de AD + status
/dashboard/sessions            → sessões ao vivo (monitoring)
/dashboard/feature-flags       → admin (toggle default)
/dashboard/integrations/twitch → instruções + status do conduit
/dashboard/integrations/kick   → instruções + OAuth start
```

## Decisões arquiteturais

- **URLs sempre relativas (`/api/*`)**. `next.config.js` faz `rewrites` para
  `SEHLORO_API_URL`. Cliente nunca conhece o host real → trocável em
  runtime sem rebuild + sem CORS dance.
- **JWT em `localStorage` + header `Authorization`**. Prototipo. Em prod
  considerar httpOnly cookie via Next middleware.
- **AuthGuard client-side** (`useAuth` + redirect). Layout do `(dashboard)`
  envolve tudo; serve para fluxo de prototipo. Para SSR-aware, mover
  para Next middleware.
- **React Query como cache único** + polling onde faz sentido (15s
  insights latest, 5s ad status, 10s sessions).
- **SSE via `fetch-event-source`** porque o backend exige Bearer token e
  o `EventSource` nativo não passa headers.

## Como rodar

### Pré-requisitos

1. Stack backend SEHLORO no ar: `docker compose up -d` em `/home/bird/workspace/sh`
2. Backend acessível em `http://localhost:8080`

### Dev local (precisa node 20+)

```bash
cp .env.example .env.local      # opcional — defaults já funcionam
npm install
npm run dev
# abre em http://localhost:3000
```

Login: `admin@sehloiro.dev / admin123` (seed do backend).

### Via Docker (sem node local)

```bash
docker build -t sehloro-console .
docker run --rm --network sehloro-net -p 3000:3000 \
  -e SEHLORO_API_URL=http://nginx:80 \
  sehloro-console
```

## Testes

```bash
npm test                # vitest (unit + components)
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run build           # next build (verifica que todas as pages compilam)
```

Cobertura mínima:
- `__tests__/utils.test.ts` — cn / formatPct / classifySentiment / formatRelative
- `__tests__/api-client.test.ts` — token storage + headers + ApiError + JSON
- `__tests__/insight-cards.test.tsx` — render dos 7 insights

## Estrutura

```
src/
├── app/
│   ├── (dashboard)/            grupo com layout protegido
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   ├── insights/
│   │   │   └── [channelId]/
│   │   ├── channels/
│   │   ├── brands/
│   │   ├── ad-control/
│   │   ├── sessions/
│   │   ├── feature-flags/
│   │   └── integrations/{twitch,kick}/
│   ├── login/
│   ├── register/
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx                redirect
│   └── providers.tsx           QueryClient + AuthProvider
├── components/
│   ├── ui/                     button, input, card, badge, empty-state
│   ├── layout/                 sidebar, topbar
│   ├── auth/                   auth-guard
│   └── insights/               insight-cards, live-feed, history-table, channel-picker
├── hooks/
│   ├── use-auth.tsx
│   └── use-sse-insights.ts
└── lib/
    ├── api-client.ts           fetch wrapper + ApiError + token storage
    ├── auth.ts                 login/logout helpers
    ├── query-client.ts
    ├── types.ts                tipos do backend
    └── utils.ts                cn / format helpers
```

## Out of scope (por ser prototipo)

- Server-side data fetching (RSC) — tudo client-side por simplicidade.
- Refresh token rotation no front.
- Dark mode.
- i18n.
- Tests E2E (Playwright) — não está rodando aqui.
- Charts (recharts/visx) — só cards textuais + barras simples Tailwind.

## Licença

Prototipo interno SEHLORO/SLMOD.
