# Shared per-company connection store

`src/lib/connections/` is the reusable multitenant storage module extracted in
**NEO-120 (T1)** from Agent Channels' proven `service-store.ts` (NEO-79). It
gives every bridge plugin — Agent Channels, Project Bridge, Knowledge Bridge —
an **identical** per-company credential + config contract instead of three
diverging copies.

Agent Channels is the **reference consumer**: `src/lib/service-store.ts` is now a
thin binding over this module (and `modules/notifications/service-notify.ts`
reuses it for the notify slot). T3/T4 port Project Bridge and Knowledge Bridge
onto the same surface.

## What it guarantees

- **Per-company isolation.** All state is namespaced under
  `{ scopeKind: "company", scopeId: companyId }`. Two companies that each connect
  their own external org never collide.
- **Legacy instance-scope fallback.** Callers with no `companyId` (health checks,
  legacy global paths) read/write the original `scopeKind: "instance"` keys. A
  `companyId` with no company-scoped value yet falls back to the legacy instance
  value, so a pre-existing single-tenant deployment keeps working until it
  reconnects. **Writes always target company scope.**
- **OAuth `state`→`companyId` routing stays intact.** The store doesn't run the
  OAuth round-trip, but it preserves the storage layout it depends on: the
  connect-url handler embeds `companyId` in the OAuth `state`, and the callback
  writes the returned token back under the same company namespace via `setAuth`.

## Public surface

```ts
import { createConnectionStore } from "./connections/index.js";

const store = createConnectionStore<Auth, Config, Rec>(options?);
```

### `createConnectionStore<Auth, Config, Rec>(options?)`

Type parameters (all optional, default `unknown` / `ConnectionRecord`):

| Param    | Meaning                                              |
| -------- | --------------------------------------------------- |
| `Auth`   | per-connection token/auth blob (e.g. `ZohoAuthState`) |
| `Config` | per-connection OAuth/config blob                    |
| `Rec`    | registry record shape (extends `ConnectionRecord`)  |

`ConnectionStoreOptions`:

| Option        | Default              | Meaning                                                                 |
| ------------- | -------------------- | ----------------------------------------------------------------------- |
| `registryKey` | `"channels.services"` | state key for the per-company connection registry array                 |
| `namespace`   | `"bridge.service"`    | prefix for per-connection slots; slot key = `${namespace}.${id}.${slot}` |

> **Defaults reproduce Agent Channels' NEO-79 layout byte-for-byte.** A new
> plugin should pick its own `registryKey` (e.g. `"projects.connections"`) but
> **keep `namespace: "bridge.service"`** so token storage is uniform across
> bridges.

### Methods

| Method | Purpose |
| ------ | ------- |
| `scopeKey(companyId, stateKey)` | build the host `ScopeKey` (company- or instance-scoped) |
| `list(ctx, companyId?)` | list a company's connections (legacy fallback) |
| `save(ctx, records, companyId?)` | replace the registry |
| `getType(ctx, id, companyId?)` | resolve a connection's `type` |
| `getAuth` / `setAuth` / `deleteAuth` | the `auth` slot |
| `getConfig` / `setConfig` / `deleteConfig` | the `config` slot |
| `getSlot<T>` / `setSlot<T>` / `deleteSlot` | any named slot (e.g. `"notify"`) |
| `findConnected(ctx, type, isConnected, companyId?)` | first connection of `type` whose auth satisfies the predicate |

`getAuth`/`getConfig`/`getSlot` and `list` all apply the company→instance
fallback; every setter and `findConnected` are built on these primitives.

### Reference usage (Agent Channels)

```ts
export const serviceStore =
  createConnectionStore<ZohoAuthState, ServiceOAuthConfig, ServiceRecord>();

// thin domain-named wrappers preserve the existing call sites:
export const getServiceAuth = (ctx, id, companyId?) => serviceStore.getAuth(ctx, id, companyId);

export async function findConnectedService(ctx, type, companyId?) {
  const f = await serviceStore.findConnected(ctx, type, (a) => Boolean(a.refreshToken), companyId);
  return f ? { serviceId: f.id, auth: f.auth } : null;
}
```

## Adopting in Project Bridge / Knowledge Bridge (T3/T4)

1. Depend on the shared package (see promotion path below) and
   `createConnectionStore<YourAuth, YourConfig>({ registryKey: "<plugin>.connections" })`.
2. Wrap the generic methods in domain-named helpers (as Agent Channels does) so
   call sites read naturally and stay decoupled from the store shape.
3. Thread `companyId` from the OAuth `state` round-trip into every read/write.
4. Port any bespoke per-connection state (notify-style mappings) onto
   `getSlot`/`setSlot` instead of re-deriving scope/fallback logic.

## Promotion path (shared package)

The module depends **only on `@paperclipai/plugin-sdk` types** (`PluginContext`,
`ScopeKey`) — no Agent-Channels imports — so it is promotable with no code edits:

- **Recommended home: `@paperclipai/plugin-sdk`** (a `./connections` subpath).
  All three bridge plugins already depend on the SDK (Knowledge Bridge needs no
  new dependency), and the SDK already owns `ScopeKey` / `ctx.state` — the exact
  primitives this store wraps.
- Promotion = move `src/lib/connections/connection-store.ts` to
  `packages/plugins/sdk/src/connections.ts`, add the `./connections` export to
  the SDK `package.json` (both `exports` and `publishConfig.exports`) and an
  `index.ts` re-export, then publish a new SDK version. Agent Channels then
  imports from `@paperclipai/plugin-sdk/connections` and deletes its local copy.

> The publish/version-bump is a release-engineering step that lands with the
> downstream adopt tasks (T3/T4) once those repos take the new SDK version. Until
> then Agent Channels consumes the module locally — same source, no copy-paste
> within this repo.

## Tests

`npm test` runs the NEO-79 isolation suite (`scripts/test-per-company.mjs` +
`scripts/test-worker-multitenancy.mjs`, **17 checks**) against the **compiled**
`service-store.js`, which now sits on this module — so the suite green-lights the
extracted store end-to-end with no behavior change.
