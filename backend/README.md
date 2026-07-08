# SEHLORO Backend

NestJS monorepo that replaces the legacy SLMOD Express API one route at a
time. The legacy service keeps serving `/api/*`; this codebase exposes new
routes under `/api/v2/*` behind the same nginx, sharing `JWT_SECRET` and the
MongoDB cluster during the migration.

## Layout

| Path           | Purpose                                                      |
| -------------- | ------------------------------------------------------------ |
| `apps/api`     | HTTP REST under `/api/v2/*` (Nest, pino, JWT, Mongoose)      |
| `apps/worker`  | Per-channel ingestion worker (standalone Nest application)   |
| `libs/domain`  | Entities, value objects, repository ports, domain events     |
| `libs/infra`   | Adapters: Mongoose, AES-256-GCM crypto, Redis, Twitch, Kick  |

Code is grouped by DDD-shaped bounded contexts: `identity`, `moderation`,
`ingestion`, `monitoring`, `social-listening`. The matching directory layout
is used in both `apps/api/src/<context>/` and `libs/infra/src/<context>/`.

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer
- MongoDB 7 (or `mongodb-memory-server`, used by the test suite)
- Optional: Redis 7.2 for the event bus and rate buckets

## Quick start

```bash
pnpm install
cp .env.example .env
# generate the master key for AES-256-GCM token envelopes
openssl rand -base64 32   # paste into CRYPTO_MASTER_KEY in .env
pnpm start:api:dev
```

The API binds to `${API_PORT:-3000}` and exposes routes under `/api/v2/*`.
The full local stack (Mongo, Redis, ClickHouse, nginx, legacy API, SPA) is
defined in the workspace `infra/` repository and brings this Dockerfile in
as the `nest-api` service.

## Environment

Every variable is validated at boot via the Zod schema in
`libs/infra/src/config/config.schema.ts`. The most relevant entries:

| Variable               | Required | Notes                                                       |
| ---------------------- | -------- | ----------------------------------------------------------- |
| `MONGODB_URI`          | yes      | MongoDB connection string                                   |
| `JWT_SECRET`           | yes      | at least 32 characters; shared with the legacy API          |
| `JWT_ACCESS_TTL`       | no       | jsonwebtoken-style TTL (default `15m`)                      |
| `JWT_REFRESH_TTL_DAYS` | no       | integer days (default `7`)                                  |
| `CRYPTO_MASTER_KEY`    | yes      | base64 of exactly 32 bytes; `openssl rand -base64 32`       |
| `CRYPTO_PREV_KEYS`     | no       | CSV of previous keys for rotation                           |
| `REDIS_URL`            | no       | enables the Redis event bus and rate buckets                |
| `CLICKHOUSE_URL`       | no       | enables the analytics adapter (consumed in later milestones)|
| `TWITCH_CLIENT_ID`     | no       | required for Helix and Twitch OAuth flows                   |
| `TWITCH_CLIENT_SECRET` | no       |                                                             |
| `KICK_CLIENT_ID`       | no       | required for Kick OAuth                                     |
| `KICK_CLIENT_SECRET`   | no       |                                                             |
| `CORS_ORIGIN`          | no       | CSV of allowed origins                                      |
| `LOG_LEVEL`            | no       | one of `fatal`, `error`, `warn`, `info`, `debug`, `trace`   |

`MONGODB_URI`, `JWT_SECRET` and `CRYPTO_MASTER_KEY` are validated to
fail-fast at process start. The other variables degrade features rather than
blocking boot.

## Scripts

```bash
pnpm start:api:dev        # API with tsx watch
pnpm start:worker         # worker (no HTTP server)
pnpm build                # tsc + tsc-alias across apps and libs
pnpm test                 # Jest across the whole workspace
pnpm --filter @sehloro/api test:e2e
pnpm lint                 # eslint --max-warnings 0
pnpm format               # prettier
```

## Architecture

### Strangler migration

nginx splits traffic by path prefix:

- `/api/v2/*` -> this Nest API
- `/api/*`    -> the legacy Express API in `SLMOD-api/`

Because both services validate against the same `JWT_SECRET`, a token issued
by either backend is accepted by the other without a bridge. Bots in the
workspace `Bots/` repository keep writing to the same MongoDB collections;
this codebase reads and writes the same documents using Mongoose schemas
that preserve legacy field names (`password`, `created_at`,
`channelWithPrefix`).

### Bounded contexts

- `identity` — users, authentication, OAuth onboarding
- `ingestion` — channels, Twitch IRC, Kick Pusher, worker orchestration
- `moderation` — bans, timeouts, deleted messages
- `monitoring` — live sessions, health, channel state
- `social-listening` — chat sentiment, categorisation, dashboards

Each bounded context is wired as a Nest module. Domain entities and
repository ports live in `libs/domain/`; adapters and outbound integrations
live in `libs/infra/`. Controllers and services compose the two.

### Authentication

`POST /api/v2/auth/login` returns a short-lived access token plus a refresh
token. Refresh tokens are SHA-256-hashed before persistence, rotated on every
refresh, and revoked in cascade when reuse of an already-revoked token is
detected. `JwtAuthGuard` is registered globally; opt out per route with the
`@Public()` decorator. The current user is injected with `@CurrentUser()`.

### Encryption at rest

`CryptoService` implements AES-256-GCM with `v1:` prefix versioning and key
rotation through `CRYPTO_PREV_KEYS`. The `@EncryptedField()` decorator wires
into a Mongoose plugin via pre/post hooks rather than getters/setters — so
reads using `.lean()` return ciphertext and must be decrypted explicitly
through `CryptoService.decryptField(...)`. Hydrated documents
(`find` / `findOne` without `lean`) decrypt automatically on `post('init')`.

### Ingestion

The `ChatProvider` contract decouples chat platforms from downstream
consumers. Current implementations:

- `TwitchIrcProvider` — wraps `tmi.js`, with refresh-token rotation and
  Helix-backed viewer counts
- `KickPusherProvider` — Pusher Channels over WebSocket with auth endpoint
  and message-deleted handling
- `MockChatProvider` — fixture replay for unit and integration tests

`ChatProviderFactory` resolves the right provider per channel, caches
instances and disposes them on demand. Any new provider must pass the
contract suite in `libs/infra/test/chat-provider-contract.spec.ts`.

### Persistence

Mongoose schemas live in `libs/infra/src/persistence/mongoose/schemas/`.
Mappers in `mappers/` convert between Mongoose documents and domain
entities. Repository adapters in `repositories/` implement the ports from
`libs/domain/`. `PersistenceModule` registers everything through
`MongooseModule.forRootAsync`.

### Feature flags

Persistent flags stored in MongoDB. Rules are evaluated first-match-wins,
keyed by channel, user or percentage. The service caches results in memory
for thirty seconds. Initial flags are seeded on application bootstrap.

## Testing

- `pnpm test` runs unit and integration tests. MongoDB is provided by
  `mongodb-memory-server`; Twitch and Kick adapters are mocked.
- Integration specs against staging channels are skipped unless
  `TWITCH_STAGING_TOKEN` or `KICK_STAGING_ACCESS_TOKEN` are set. See
  `TESTING.md` for the full procedure.
- The `ChatProvider` contract suite guarantees that any provider honours
  the shared invariants and is reused across mock, Twitch and Kick.

## Docker

The `Dockerfile` is multi-stage: a builder image runs `pnpm install` and
`pnpm build`, and the runtime image is `node:20-alpine` with only `dist/`
and production dependencies. The workspace `infra/` repository wires it
into a Compose stack alongside Mongo, Redis, ClickHouse, nginx, the legacy
API and the SPA so a single `docker compose up` reproduces the full
environment locally.

## Project status

This is the initial drop. Foundation and orchestration are in place;
EventSub Conduits, the Redis chat buffer, monitoring auto-start handlers
and the analytics pipeline are tracked under follow-up milestones in
`docs/tasks/` in the workspace root.

## License

Proprietary — internal SEHLORO project.
