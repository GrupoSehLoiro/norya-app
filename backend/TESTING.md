# Testing Guide — SEHLORO Backend

## Unit and integration tests (no external services)

```bash
cd backend
pnpm test                     # everything
pnpm --filter @sehloro/infra test
pnpm --filter @sehloro/domain test
```

Unit tests run without any external service: MongoDB is provided by
`mongodb-memory-server` and Twitch / Kick adapters are mocked through
`jest.mock('axios')` and `jest.mock('pusher-js')`.

---

## Integration tests against real channels

### TWI-05 · TwitchIrcProvider — Twitch staging channel

**File:** `libs/infra/test/ingestion/twitch-irc.integration.spec.ts`

These tests are **skipped automatically** when `TWITCH_STAGING_TOKEN` is not
present in the environment. To run them:

#### 1. Obtain a staging OAuth token

Use the Twitch Implicit Grant flow with a development application:

```
https://id.twitch.tv/oauth2/authorize
  ?response_type=token
  &client_id=<YOUR_CLIENT_ID>
  &redirect_uri=http://localhost:3000
  &scope=chat:read
```

The `access_token` lands in the redirect URL fragment. Tokens last about
four hours; generate a new one when it expires.

#### 2. Export the token

```bash
export TWITCH_STAGING_TOKEN=<your_access_token>
# Optional: change the target channel (default: rogerbatt)
export TWITCH_STAGING_CHANNEL=rogerbatt
```

#### 3. Run the test

```bash
cd backend
npx jest --config libs/infra/jest.config.cjs \
         --testPathPattern=twitch-irc.integration \
         --runInBand \
         --testTimeout=130000
```

> **Note:** `--runInBand` avoids TCP port conflicts between parallel test
> workers.

#### Notes

- The `rogerbatt` channel has active chat most of the day and night. If it
  is offline, switch to another high-volume channel (for example `gaules`
  or `loud_coringa`).
- The test timeout is 120 seconds; low-traffic channels may time out.
- `--detectOpenHandles` can be added to confirm that the IRC socket closes
  cleanly after `disconnect()`.

---

### KCK-05 · KickPusherProvider — Kick staging channel

**File:** `libs/infra/test/ingestion/kick-pusher.integration.spec.ts`

Skipped unless `KICK_STAGING_ACCESS_TOKEN` is set.

#### Obtaining the Pusher APP_KEY (Kick)

Kick uses a self-hosted Pusher Channels deployment. The current `APP_KEY`
can be captured by inspecting the WebSocket traffic at
`wss://ws-us2.pusher.com`:

```
# Open DevTools on kick.com and filter by WS
# The first connection frame contains the app_key
```

Current value (May 2026): `32cbd69e4b950bf97679`
*(Record any change here; rotation plan: re-capture on each Kick release.)*

To obtain a staging Kick OAuth access token:

1. Set `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET` in `.env`.
2. Hit `GET /api/v2/auth/kick/start?channelId=<id>` and complete the OAuth
   flow in the browser.
3. After the callback completes, the token is stored encrypted in MongoDB.
   Read it from a shell, or call `KickOAuthService.getValidToken(channelId)`
   in a bootstrap script.

```bash
export KICK_STAGING_ACCESS_TOKEN=<token>
export KICK_STAGING_CHANNEL=xqc   # or a channel the team controls

npx jest --config libs/infra/jest.config.cjs \
         --testPathPattern=kick-pusher.integration \
         --runInBand \
         --testTimeout=100000
```

---

## Contract tests

Verifies that any `ChatProvider` implementation honours the shared
invariants:

```bash
npx jest --config libs/infra/jest.config.cjs \
         --testPathPattern=chat-provider-contract
```

To register a new provider against the contract, import
`runChatProviderContract` from
`libs/infra/test/chat-provider-contract.spec.ts` and pass a function that
returns a fresh instance of the provider.
