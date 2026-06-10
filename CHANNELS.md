# Adding a Channel

This plugin is a **template** for connecting Paperclip agents to messaging
channels. Channels (Zoho Cliq, Mail, Zoho Desk, external bridges, …) plug into
shared infrastructure through the `ChannelModule` contract and a registry — so
adding a channel is a **registration call, never an edit to core dispatch**.

The Cliq module (`src/modules/cliq/`) is the reference implementation; the Mail
module (`src/modules/mail/`) is a minimal skeleton proving the pattern.

## The contract

Every channel implements [`ChannelModule`](src/lib/types.ts):

| Member | Required | Purpose |
| --- | --- | --- |
| `webhookKey: string` | ✅ | The manifest webhook `endpointKey` this channel listens on. Unique across channels; must match a `webhooks[].endpointKey` in the manifest. |
| `handleWebhook(ctx, input, companyId?): Promise<WebhookResult>` | ✅ | Handle one inbound delivery. Return `{ handled: true }` when acted on, `{ handled: false, note }` for recognized-but-ignored events. Avoid throwing for routine "not for me" cases. |
| `getServiceType(): string` | ✅ | Service-type id matching `channels.services[].type` (e.g. `"zoho-cliq"`). Used to route post-OAuth setup. |
| `onOAuthComplete?(ctx, serviceId, auth, companyId?): Promise<void>` | optional | Post-OAuth hook. Channels reusing the shared `oauth-callback` endpoint are dispatched here after token exchange, routed by `state.channelType`. `companyId` identifies the owning company (NEO-79). Omit for channels without OAuth. |

`WebhookResult` is `{ handled: boolean; note?: string }`.

## Per-company token storage (multitenancy)

Token storage is namespaced **per company** so multiple companies can each connect
their own Zoho org without interfering (NEO-79). All service registry, auth, and
config reads/writes go through [`src/lib/service-store.ts`](src/lib/service-store.ts),
which partitions state by `{ scopeKind: "company", scopeId: companyId }`:

| State | Key | Scope |
| --- | --- | --- |
| Service registry | `channels.services` | per company |
| OAuth tokens | `bridge.service.{serviceId}.auth` | per company |
| OAuth credentials | `bridge.service.{serviceId}.config` | per company |
| Notify mapping | `bridge.service.{serviceId}.notify` | per company |

- The settings UI scopes everything to a selected company; the `connect-url` data
  handler embeds `companyId` in the OAuth `state` param so `handleOAuthCallback`
  stores the returned token under the right namespace.
- The send path threads a `CliqScope` (`{ companyId, serviceId }`) so a bot always
  authenticates as its own company's Zoho org. The webhook handler derives
  `companyId` from the bot→agent mapping.
- The `cliq-token-refresh` job iterates every company's service list.
- **Legacy bridge:** callers without a `companyId` (health checks) and companies
  with no company-scoped state yet fall back to the original `instance` scope, so a
  pre-existing single-tenant deployment keeps working until it reconnects. Writes
  always go to company scope.
- Isolation is covered by `scripts/test-per-company.mjs` and
  `scripts/test-worker-multitenancy.mjs` (`npm test`).

## How dispatch works

- `onWebhook` (in `src/worker.ts`) looks up `getChannel(input.endpointKey)` in
  the registry and calls `handleWebhook`. There is no per-channel `switch`.
- The `oauth-callback` endpoint is **shared** by all channels. After exchanging
  the code for tokens, `handleOAuthCallback` reads `state.channelType` and calls
  the matching channel's `onOAuthComplete`. If `channelType` is absent it falls
  back to the service's stored `type`, so older connect URLs keep working.

## Manifest entry shape

Each channel webhook endpoint is declared in `src/manifest.ts` under `webhooks`:

```ts
{
  endpointKey: "mail-inbound",        // REQUIRED — must equal the module's webhookKey
  displayName: "Mail Inbound",        // REQUIRED — shown in the plugin UI
  description: "Receives inbound mail events",  // REQUIRED — one-line summary
}
```

Required fields per channel webhook endpoint:

- **`endpointKey`** — unique string; the registry key. Must equal the
  `ChannelModule.webhookKey` of the module that handles it.
- **`displayName`** — human-readable label.
- **`description`** — one-line description of what the endpoint receives.

Channels needing OAuth reuse the existing shared `oauth-callback` endpoint — do
**not** add a second OAuth webhook.

## Add a channel — checklist

1. **Create the module** `src/modules/<channel>/index.ts` exporting a
   `ChannelModule` (copy `src/modules/mail/index.ts` as a starting point).
2. **Add a webhook key** to `WEBHOOK_KEYS` in `src/constants.ts`.
3. **Declare the manifest webhook** in `src/manifest.ts` (`endpointKey` =
   your `webhookKey`).
4. **Register it** in `src/channels.ts`: `registerChannel(myChannel)`.
5. **(If OAuth)** implement `onOAuthComplete`, and have your connect URL emit
   `state.channelType` equal to `getServiceType()` so the shared callback routes
   post-auth setup to you. The `connect-url` data handler already does this via
   the service's stored `type`.

No edits to `onWebhook`, `handleOAuthCallback`, or any other channel's code are
required — that is the acceptance bar for this pattern.

## Reinstall re-verification

After every plugin reinstall or Zoho API console change, run the smoke-test
script to verify the deployment is wired correctly:

```bash
# SOURCE checks only (no network — safe in CI)
scripts/smoke-test.sh

# SOURCE + live HTTP probes against the deployed host
SMOKE_LIVE=1 scripts/smoke-test.sh

# Full interactive verification including Zoho console and OAuth round-trip
scripts/smoke-test.sh --live --manual
```

The script exits non-zero on any failure. Check categories:

| Category | What it verifies | When it runs |
| --- | --- | --- |
| **SOURCE** | Manifest webhook keys, worker dispatch wiring, `state.pluginId`, default URLs | Always |
| **LIVE** | `POST /cliq → 200`, `GET /oauth/callback?code=x&state=... → 200` | `SMOKE_LIVE=1` or `--live` |
| **MANUAL** | Zoho console redirect URI, full Connect → `tokenValid: true` round-trip | `SMOKE_MANUAL=1` or `--manual` |

Environment variables: `SMOKE_BASE_URL` (default `https://cortex.neoreef.com`),
`SMOKE_REQUIRE_LIVE=1` (treat unreachable host as failure).
