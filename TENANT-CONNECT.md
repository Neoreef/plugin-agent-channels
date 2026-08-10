# Tenant-facing connect surface (PRE-790 / PRE-329 T2)

A tenant holding **only their per-company connect link** can authorize Zoho and
have tokens land in their **company-scoped** store — with **zero access to the
operator settings UI**.

## Operator vs. tenant surface split

| Concern | Operator surface | Tenant surface (this work) |
| --- | --- | --- |
| Zoho OAuth **client** (id / secret / callback) | Set once in plugin **instance** config (`manifest.instanceConfigSchema`). App-level, shared by all tenants. | Never seen or supplied by the tenant. |
| Per-service OAuth config (`save-service-oauth-config`) | Operator settings page (`src/ui/index.tsx` → `OAuthSetup`). | **Not used.** Decoupled. |
| Per-company **non-OAuth** config (data center, scopes, enabled channels) | — | Stored under **company scope** via the T1 `src/lib/connections/` store scoping. |
| Authorize URL | `connect-url` data handler (operator UI). | `buildTenantConnectUrl()` — **same URL assembly** via `assembleAuthorizeUrl()`. |
| Token return path | Existing `oauth-callback` webhook. | **Same webhook, unchanged.** `state.companyId` namespaces the token per company (NEO-79). |

Both surfaces build the authorize URL through the single `assembleAuthorizeUrl()`
helper in `src/lib/tenant-connect.ts`, so they cannot drift.

## The per-tenant link

Declared as a manifest `apiRoutes` entry (`routeKey: "tenant-connect"`), the host
mounts it at:

```
GET /api/plugins/agent-channels/api/connect?companyId=<COMPANY_ID>
```

- `auth: "webhook"` → public bearer link; the host resolves `companyId` from the
  query (`companyResolution: { from: "query", key: "companyId" }`).
- Default response: the hosted **"Connect your org"** HTML page (parameterized by
  `companyId`) with a single "Connect Zoho" button.
- `&format=json` → `{ configured, connectUrl, serviceId, channelType }` for
  programmatic callers (e.g. landing-page templating).
- `&channelType=<type>` → override the channel (defaults to the company's first
  enabled channel, i.e. `zoho-cliq`).

No plugin admin UI is required by the tenant.

## Security

- **Per-company token scoping** — the OAuth `state` carries `companyId`; the
  callback writes auth via `serviceStore.setAuth(serviceId, …, companyId)`. A
  company can never read another company's token (verified in
  `scripts/test-tenant-connect.mjs`).
- **CSRF** — every tenant-issued authorize URL carries a single-use, company-scoped
  `nonce` (15-min TTL) in `state`. `handleOAuthCallback` consumes + validates it
  for `state.src === "tenant"` flows before any credential use. Operator connect
  URLs omit `src`/`nonce` and are unaffected.
- **No secret exposure** — the client *secret* is used only server-side during the
  token exchange; it never appears on the hosted page or in the authorize URL.

## Deploy handoff → Nicole (PRE-789)

The plugin exposes the route above. The board-approved D1(a) path fronts it with
the **existing Caddy generic landing gateway**:

- Route the tenant-facing path (e.g. `/connect/:companyId`) to
  `GET /api/plugins/agent-channels/api/connect?companyId=:companyId` on the host,
  via the **pinned release manifest only**.
- Ensure the plugin instance config has `zohoClientId`, `zohoClientSecret`, and
  `oauthCallbackUrl` set (the app-level Zoho client), and that
  `oauthCallbackUrl` matches the redirect URI registered in the Zoho app.
- Verify health / rollback per PRE-789. Guard against Caddy route collision with
  the existing `oauth-callback` path.

## Verification

`node scripts/test-tenant-connect.mjs` (also part of `npm test`) proves: tenant
with only `companyId` → valid authorize URL from the app client; secret never
exposed; company-scoped + idempotent service provisioning; round-trip token lands
in the company store and is invisible to other companies; CSRF nonce single-use +
company-isolated; per-company config isolation; disabled-channel rejection.
