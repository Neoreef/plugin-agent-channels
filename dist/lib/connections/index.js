/**
 * `connections` — shared per-company connection store (NEO-120).
 *
 * Public entrypoint for the reusable multitenant storage module. Agent Channels
 * is the reference consumer (see `src/lib/service-store.ts`); Project Bridge and
 * Knowledge Bridge adopt this same surface in NEO-120 T3/T4.
 *
 * This module depends only on `@paperclipai/plugin-sdk` types, so it is
 * promotable to a shared package (`@paperclipai/plugin-sdk` connections subpath)
 * with no edits — see `CONNECTIONS.md` for the promotion path.
 */
export { createConnectionStore, } from "./connection-store.js";
//# sourceMappingURL=index.js.map