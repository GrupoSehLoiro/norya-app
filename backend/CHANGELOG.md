# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Redis utilities (`libs/infra/src/cache`)
- `ChatBufferService` (RED-01): per-channel rolling buffer of recent
  chat messages on Redis. `push` / `drain` / `peek` / `length`, atomic
  via MULTI/EXEC, capped at 1000 entries with a 60-second TTL.
- `SlidingWindowService` (RED-02): rolling event counter on Redis
  sorted sets. `record` / `count` / `rate` / `clear`, with automatic
  cleanup of entries older than the retention window (60 seconds).
- `LlmRateLimiterService` (RED-03): per-streamer monthly token budget
  and per-minute throttle enforced atomically through a Lua script.
  Reports the rejection reason (`monthly` or `minute`) plus the reset
  timestamp; `acquire(...)` is the throwing variant.

#### Twitch EventSub Conduits
- `TwitchConduitService` (CON-01): idempotent `ensureConduit` /
  `assignShards` / `deleteConduit`. Singleton conduit state persisted
  in MongoDB; reconciles with Helix on every call.
- `TwitchConduitSubscriptionsService` (CON-02): creates and tears down
  the three EventSub subscriptions per channel
  (`channel.chat.message`, `stream.online`, `stream.offline`) with
  409-on-create / 404-on-delete tolerance and local persistence of
  subscription IDs.
- `TwitchEventSubWsClient` (CON-03, in `apps/worker`): WebSocket shard
  receiver for `wss://eventsub.wss.twitch.tv/ws`. Handles
  `session_welcome` (triggers shard assignment), `session_keepalive`,
  `notification`, `session_reconnect` (URL swap), `revocation`, with
  exponential backoff up to 30 seconds.
- `TwitchEventSubBridge` (worker): maps EventSub notifications to
  domain events — `channel.chat.message` lands in `ChatBufferService`
  and the `chat.message` bus channel; `stream.online` / `stream.offline`
  publish typed payloads. Revocation marks the subscription locally.
- `TwitchConduitWorkerModule`: wires the conduit service, bridge, WS
  client and bootstrap orchestrator inside the worker app.
- `TwitchHmacGuard` (CON-04, in `apps/api`): signature check, 10-minute
  anti-replay window and `message_id` nonce deduplication. Backed by
  `NonceStore` with Redis (when available) or in-memory fallback.
- `TwitchWebhookController`: receives EventSub webhook callbacks
  (verification, notification, revocation). Coexists with the
  WebSocket transport; only one needs to be active per conduit.
- `SubscriptionRenewerService` + cron (CON-05): daily 04:00 sweep that
  recreates EventSub subscriptions whose status drifted away from
  `enabled`. Gated by feature flag `twitch.subscription.autoRenew`.
- `TwitchAdminController`: `GET /api/v2/admin/twitch/subscriptions` for
  the current status and `POST /api/v2/admin/twitch/subscriptions/renew`
  for an admin-triggered renew run.

#### Monitoring (auto-start, real endpoints, stale closer)
- `MonitoringService` (MON-02): real session lifecycle.
  `startSession` / `startSessionStrict` / `endSession` /
  `endActiveByChannel` / queries, with ownership assertion.
- `MonitoringController` REST endpoints under `/api/v2/monitoring`:
  `POST sessions/start`, `POST sessions/:id/stop` (also `DELETE`),
  `GET sessions`, `GET sessions/:id`, `GET ping`.
- `TwitchStreamLifecycleHandler` (MON-03): subscribes to
  `twitch.stream.online` / `twitch.stream.offline` on the event bus,
  opens/closes `LiveSession` automatically when the feature flag
  `monitoring.autoStart` is enabled.
- `SessionStaleCloserCron` (MON-04): every 10 minutes ends
  `ACTIVE` sessions whose last event is older than 15 minutes.
- `findStaleActive` added to `LiveSessionRepository` port and the
  Mongoose adapter.
- Monitoring integration flow e2e (MON-05) covers `online` → `offline`
  end-to-end against `mongodb-memory-server`.

#### Other infrastructure
- `CacheModule` exposes a shared `ioredis` client through `REDIS_TOKEN`
  and registers `ChatBufferService`, `SlidingWindowService` and
  `LlmRateLimiterService` when the `redis` driver is selected.
- Feature flag `monitoring.autoStart` (default `true`) seeded on
  bootstrap.
- Domain event channel constants `STREAM_ONLINE_CHANNEL` and
  `STREAM_OFFLINE_CHANNEL` plus their typed payloads.
- Worker app: `ws` dependency, Jest configuration aligned with
  `libs/infra`.
- API app: `ioredis` / `ioredis-mock` dependencies, `rawBody: true`
  enabled on bootstrap so the webhook HMAC guard can validate signatures.

### Changed

- `CacheModule` driver selection accepts `EVENT_BUS_DRIVER=memory|redis`
  and degrades gracefully when no Redis URL is configured.
- Config schema (`libs/infra/src/config/config.schema.ts`) now accepts
  the optional `TWITCH_WEBHOOK_SECRET`, `TWITCH_CONDUIT_SHARD_COUNT`
  and `TWITCH_BOT_USER_ID` variables.

## [0.1.0] - 2026-05-11

First tagged drop of the SEHLORO/SLMOD NestJS backend. Establishes the
monorepo, the DDD-shaped bounded contexts, and the ingestion stack for
Twitch and Kick. Replaces nothing yet — the legacy Express service keeps
serving `/api/*` while this codebase exposes `/api/v2/*` behind the same
nginx and shares `JWT_SECRET` and MongoDB during the migration.

### Added

#### Workspace

- pnpm workspace with apps (`api`, `worker`) and libs (`domain`, `infra`).
- Base TypeScript configuration, Nest CLI config and multi-stage Dockerfile.
- ESLint + Prettier with `--max-warnings 0`.
- `.env.example` with every variable consumed by the Zod config schema.

#### Domain (`libs/domain`)

- Base `DomainError` and shared identity value type.
- Identity context: `User` and `RefreshToken` entities with repository ports.
- Ingestion context: `Channel`, `ChannelOAuthToken` entities with ports;
  `ChatProvider` interface; `RawMessage` type and Zod schema;
  `EmoteDictionary` interface with a curated Twitch seed.
- Monitoring context: `LiveSession` entity with repository port.
- Cross-cutting: `EventBus` interface for in-process and pub/sub buses.

#### Infrastructure (`libs/infra`)

- Zod configuration schema shared by both apps, fail-fast on boot.
- `CryptoService` implementing AES-256-GCM envelope encryption with prefix
  versioning, authenticated integrity, and rotation through previous keys.
- `@EncryptedField()` decorator backed by a Mongoose pre/post hook plugin —
  reads via `.lean()` deliberately return ciphertext.
- Mongoose schemas, mappers and repository adapters for `User`, `Channel`,
  `ChannelOAuthToken`, `RefreshToken`, `LiveSession`. Schemas for
  `FeatureFlag` and `WorkerState`. Field names preserved where the legacy
  bots still write to the same Mongo collections.
- `PersistenceModule` wiring all schemas through `MongooseModule.forRootAsync`.
- Cache module with an in-memory event bus (default for tests) and a Redis
  event bus.
- Ingestion adapters:
  - `MockChatProvider` with fixture-driven replay and configurable scale.
  - `TwitchIrcProvider` wrapping `tmi.js`, plus `TwitchMessageMapper`,
    `TwitchHelixService` (app token caching, backoff, rate limiting) and
    `TwitchTokenRefresher` (per-channel mutex, persistence, revocation
    events).
  - `KickPusherProvider` over Pusher Channels, `KickMessageMapper`,
    `KickRestClient` (chatroom lookup, viewer count, cache + retry) and
    `KickOAuthService` (authorization code flow, encrypted token storage,
    auto-refresh).
  - `ChatProviderFactory` resolving providers per channel with instance
    caching and disposal.

#### API application (`apps/api`)

- Bootstrap with global validation, helmet, CORS and prefix `/api`.
- Zod-validated `ConfigModule` re-exporting the shared schema.
- `nestjs-pino` logger with pretty transport in development and request
  bindings via `nestjs-cls`.
- Global exception filter mapping `HttpException`, `ZodError`, Mongoose
  errors and domain errors to a consistent envelope without leaking stacks
  in production.
- `ZodValidationPipe` for request body / query validation.
- Identity module skeleton and `auth` submodule with:
  - Local password login and refresh-token rotation.
  - Refresh-token reuse detection that revokes the whole token family.
  - `JwtStrategy`, `JwtAuthGuard` registered globally, `@Public()` and
    `@CurrentUser()` decorators.
  - Argon2-based password hasher.
- Kick OAuth controller exposing the `start` and `callback` endpoints with
  signed state.
- Module skeletons for `moderation`, `social-listening`, `monitoring`,
  `ingestion`.
- Channels CRUD under `ingestion` with DTO validation, external-id
  resolution and admin gating on write paths.
- `OrchestratorService` with pluggable backends (Docker remote API and
  child process) for spawning per-channel workers; `ReconcilerService` loop
  that keeps the worker set aligned with the active-channel set.
- `FeatureFlagsModule` with rule-based evaluation (channel / user /
  percentage), in-process cache, admin endpoints and bootstrap seed.
- E2E harness with bootstrap and module-ping specs.

#### Worker application (`apps/worker`)

- Standalone Nest application scaffold (no HTTP server) for per-channel
  ingestion runners.

#### Testing

- Unit and integration tests covering crypto, Mongoose repositories,
  Twitch helix/mapper/refresher, Kick OAuth and mapper, mock provider,
  ChatProvider factory, JWT strategy/guard and the auth service.
- `ChatProvider` contract suite parameterised by provider factory.
- Replayable chat fixtures (Twitch Valorant sample, Kick xQc sample,
  copypasta burst, Brazilian-Portuguese hype).
- Opt-in integration specs for Twitch IRC and Kick Pusher against staging
  channels, gated by environment variables.

#### Documentation

- Testing guide covering local runs, integration toggles and the contract
  suite.

### Security

- All OAuth tokens (Twitch, Kick) are persisted encrypted at rest through
  the AES-256-GCM envelope. The master key is required for boot;
  previous keys can be supplied as CSV for rotation without re-encrypting
  historic data.
- Refresh tokens are SHA-256-hashed before storage. Detected reuse of a
  revoked refresh token triggers cascading revocation of the descendant
  chain.
- The Zod config schema enforces a 32-byte master key and a JWT secret of
  at least 32 characters at process start.
