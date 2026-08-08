# Cross-Company Project Handoff — Agent Channels

**Repository:** `plugin-agent-channels` (shared repo; recipient has its own clone)  
**Source status snapshot:** 20 tasks — backlog: 2, blocked: 4, cancelled: 3, done: 9, in_review: 2

> This document is a **self-contained** handoff. It assumes you have **no** access to the source
> company's board, task IDs, agents, files, hosts, credentials, or history. Every task is named
> and placed in a hierarchy; every assignee is given by **role**, never by person. Reproduce this
> tree on your own board. Technical detail is preserved by the **shape** of the systems, not by the
> source company's identifiers.

**Terminology & self-containment.** This platform derives from a publicly available upstream open-source project (referred to here as *the base platform*); that upstream is the only external reference and can be independently obtained. Task names, statuses, hierarchy, and dependencies below carry **no** source-company IDs, person names, host paths, or internal URLs. Literal `PAPERCLIP_*` tokens that remain are **runtime environment-variable names** shared by the identical base platform runtime — they are functional configuration keys you will use verbatim, not brand references.


## How to execute this handoff

1. **Create parents before children.** Walk the Task Register top-down. Create each parent task,
   then its children, linking by **name** (you will assign your own IDs).
2. **Set status faithfully** using the mapping below. Recreate blocker links *before* setting a
   task to `blocked`.
3. **Assign by role.** The recipient company has the **same roles, different individuals**. Use the
   *Recommended owner* on each task (same functional role on your side). `unassigned / board-owned`
   tasks stay owned by your CEO/board until you assign them.
4. **Cancelled tasks are NOT recreated** — they appear only as historical context so the tree reads
   faithfully.
5. **Related sibling / predecessor trees** referenced by a task are noted as *context*; they are
   recreated under **their own root**, not duplicated under the referencing task.

### Status mapping

- `done → **done** (completed; recreate as historical record, mark done)`
- `backlog → **backlog**`
- `blocked → **blocked** (recreate blocker link, then set blocked)`
- `in_review → **in_review** (in review / awaiting approval)`
- `cancelled → **do NOT recreate**; listed as historical context only`

### Role legend (source role → recreate as)

- **CEO** → CEO (same role, recipient's own individual)
- **Chief Technology Officer** → Chief Technology Officer (same role, recipient's own individual)
- **Data Science & Analytics** → Data Science & Analytics (same role, recipient's own individual)
- **DevOps & Infrastructure** → DevOps & Infrastructure (same role, recipient's own individual)
- **Executive Assistant to the CEO** → Executive Assistant to the CEO (same role, recipient's own individual)
- **QA & Testing** → QA & Testing (same role, recipient's own individual)
- **board-owned (human founder/CEO)** → recipient CEO / board (assign or keep board-owned)
- **unassigned / board-owned** → recipient CEO / board (assign or keep board-owned)

## Summary tree (task · status · role)

```
✓ Move token storage to per-company (multitenant)  ·  done  ·  board-owned (human founder/CEO)
  ◐ T1 — Extract shared per-company connection module  ·  in_review  ·  Data Science & Analytics
  ● Agent Channels — tenant-facing connect surface  ·  blocked  ·  Data Science & Analytics
  ✗ T2 test  ·  cancelled  ·  Data Science & Analytics
  ● T2 — Agent Channels: tenant-facing connect surface  ·  blocked  ·  Data Science & Analytics
  ● T5 — Docs + reinstall re-verification for tenant-facing multitenancy  ·  blocked  ·  DevOps & Infrastructure
✓ Extend channel pattern beyond Zoho Cliq  ·  done  ·  QA & Testing
✓ Agent Channels  ·  done  ·  board-owned (human founder/CEO)
✗ First message fail  ·  cancelled  ·  Executive Assistant to the CEO
✓ the base platform system instructions  ·  done  ·  CEO
○ Agent Channel the base platform Skills  ·  backlog  ·  Chief Technology Officer
✓ Agents not responding in Cliq Channels  ·  done  ·  CEO
  ✓ Part A: Normalize Cliq participation payload in webhook-handler (channel fix)  ·  done  ·  Chief Technology Officer
  ✗ Part B (optional): Forward mentions/channel/operation from Cliq Deluge participation handler  ·  cancelled  ·  Chief Technology Officer
  ✓ Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)  ·  done  ·  board-owned (human founder/CEO)
  ◐ Cliq channel reply latency: progress ack + per-turn timing + warm-process  ·  in_review  ·  Chief Technology Officer
    ● Warm/pooled Cliq harness process (eliminate cold subprocess per turn)  ·  blocked  ·  Chief Technology Officer
✓ Plugin webhook→async host calls denied by invocation-scope hardening (blocks Cliq channel replies)  ·  done  ·  Chief Technology Officer
○ Cliq bot: first message doesn't trigger a response (takes two messages)  ·  backlog  ·  unassigned / board-owned
✓ Pull changes  ·  done  ·  Chief Technology Officer
```

Legend: ✓ done · ✗ cancelled (not recreated) · ● blocked · ◐ in_review · ○ backlog/todo

## Task register (create in this order)

### Move token storage to per-company (multitenant)

- **Hierarchy:** Move token storage to per-company (multitenant)
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** board-owned (human founder/CEO)
- **Recommended owner:** recipient CEO / board (assign or keep board-owned)
- **Priority:** medium
- **Children (create after this task):** “T1 — Extract shared per-company connection module”; “Agent Channels — tenant-facing connect surface”; “T2 test”; “T2 — Agent Channels: tenant-facing connect surface”; “T5 — Docs + reinstall re-verification for tenant-facing multitenancy”
- **Related context (not recreated under this task):** “Per-company connection / OAuth config”; “Per-company token storage (multitenancy)”; “Reinstall re-verification smoke-test script”; “T3 — Project Bridge: adopt per-company connection pattern”; “T4 — Knowledge Bridge: tenant-facing connect surface”; “Verify Zoho OAuth token refresh path”; “Token refresh: verify past expiry + per-service dedup”; “Channel extension pattern: ChannelModule interface + registry”

### T1 — Extract shared per-company connection module

- **Hierarchy:** Move token storage to per-company (multitenant) › T1 — Extract shared per-company connection module
- **Parent:** “Move token storage to per-company (multitenant)”
- **Status:** in_review  →  set **in_review**
- **Original owner (role):** Data Science & Analytics
- **Recommended owner:** Data Science & Analytics (same role, recipient's own individual)
- **Priority:** high
- **Blocks:** “Agent Channels — tenant-facing connect surface” (blocked); “T2 — Agent Channels: tenant-facing connect surface” (blocked); “T2 test” (cancelled); “T3 — Project Bridge: adopt per-company connection pattern” (blocked); “T4 — Knowledge Bridge: tenant-facing connect surface” (blocked)
- **Related context (not recreated under this task):** “Per-company token storage (multitenancy)”

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  ## T1 — Extract shared per-company connection module

  **Parent:** [“Move token storage to per-company (multitenant)”]”) · **Decision:** D2(a) — extract now (board-approved)

  Promote the proven per-company storage pattern in `src/lib/service-store.ts` (shipped in [a related task]) into a small, reusable **connections** library that all three bridge plugins (Agent Channels, Project Bridge, Knowledge Bridge) consume, so the multitenant contract is identical everywhere.

  ### Scope
  - Extract a scope-keyed per-company credential + config store: read/write namespaced under `{ scopeKind: "company", scopeId: companyId }` with the **legacy instance-scope fallback** preserved (single-tenant deployments must keep working).
  - Keep the OAuth `state`→`companyId` routing contract intact (return path namespacing).
  - Package so Project Bridge and Knowledge Bridge can import it (shared package/module, not a copy-paste).
  - Port Agent Channels' existing `service-store.ts` onto the extracted module as the reference consumer.

  ### Done when
  - Shared module exists and is consumed by Agent Channels with **no behavior change** (existing isolation suite still green: `npm test` → 17/17).
  - Public surface documented for the other two plugins to adopt (T3/T4).

  This is the foundation: **T2, T3, T4 are blocked by this.**

  </details>

### Agent Channels — tenant-facing connect surface

- **Hierarchy:** Move token storage to per-company (multitenant) › Agent Channels — tenant-facing connect surface
- **Parent:** “Move token storage to per-company (multitenant)”
- **Status:** blocked  →  set **blocked**
- **Original owner (role):** Data Science & Analytics
- **Recommended owner:** Data Science & Analytics (same role, recipient's own individual)
- **Priority:** high
- **Blocked by (create/link first):** “T1 — Extract shared per-company connection module” (in_review)
- **Related context (not recreated under this task):** “Per-company token storage (multitenancy)”

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  ## T2 — Agent Channels: tenant-facing connect surface

  **Parent:** [“Move token storage to per-company (multitenant)”]”) · **Repo:** `plugin-agent-channels` · **Decision:** D1(a) — hosted self-service connect page via the existing Caddy gateway (board-approved)

  Per-company storage already exists ([a related task]), but connecting/configuring is still driven from the **operator** settings UI (`src/ui/index.tsx` → `OAuthSetup`, `save-service-oauth-config`). Tenants won't have that surface. Build the tenant-facing path.

  ### Scope
  - Hosted **"Connect your org"** page parameterized by `companyId`, served via the existing Caddy generic landing gateway.
  - Issue a per-tenant connect link that reuses the **existing `oauth-callback` webhook** — OAuth `state` already carries `companyId` (a related task), so the return path already namespaces per company. **No plugin admin UI required by the tenant.**
  - Store per-company non-OAuth config (data center, scopes, enabled channels) under company scope alongside credentials, via the T1 shared module.

  ### Done when
  - A tenant with only their connect link can authorize Zoho and have tokens land in their company-scoped store, with zero access to the operator config UI.
  - Round-trip verified (connect → token stored under company scope → Cliq message round-trips).

  **Blocked by [“T1 — Extract shared per-company connection module”] (T1).**

  </details>

### T2 test

- **Hierarchy:** Move token storage to per-company (multitenant) › T2 test
- **Parent:** “Move token storage to per-company (multitenant)”
- **Status:** cancelled  →  set **do not recreate**
- **Original owner (role):** Data Science & Analytics
- **Recommended owner:** Data Science & Analytics (same role, recipient's own individual)
- **Priority:** high
- **Blocked by (create/link first):** “T1 — Extract shared per-company connection module” (in_review)

### T2 — Agent Channels: tenant-facing connect surface

- **Hierarchy:** Move token storage to per-company (multitenant) › T2 — Agent Channels: tenant-facing connect surface
- **Parent:** “Move token storage to per-company (multitenant)”
- **Status:** blocked  →  set **blocked**
- **Original owner (role):** Data Science & Analytics
- **Recommended owner:** Data Science & Analytics (same role, recipient's own individual)
- **Priority:** high
- **Blocked by (create/link first):** “T1 — Extract shared per-company connection module” (in_review)
- **Blocks:** “T5 — Docs + reinstall re-verification for tenant-facing multitenancy” (blocked)
- **Related context (not recreated under this task):** “Per-company token storage (multitenancy)”

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  ## T2 — Agent Channels: tenant-facing connect surface

  Part of the [“Move token storage to per-company (multitenant)”]”) multitenant initiative. **Repo:** `plugin-agent-channels`. **Decision:** D1(a) — hosted self-service connect page via the existing Caddy gateway (board-approved).

  Per-company storage already exists ([a related task]), but connecting/configuring is still driven from the **operator** settings UI (`src/ui/index.tsx` -> `OAuthSetup`, `save-service-oauth-config`). Tenants won't have that surface. Build the tenant-facing path.

  ### Scope
  - Hosted **"Connect your org"** page parameterized by `companyId`, served via the existing Caddy generic landing gateway.
  - Issue a per-tenant connect link that reuses the **existing `oauth-callback` webhook** — OAuth `state` already carries `companyId` ([a related task]), so the return path already namespaces per company. **No plugin admin UI required by the tenant.**
  - Store per-company non-OAuth config (data center, scopes, enabled channels) under company scope alongside credentials, via the [“T1 — Extract shared per-company connection module”] (T1) shared module.

  ### Done when
  - A tenant with only their connect link can authorize Zoho and have tokens land in their company-scoped store, with zero access to the operator config UI.
  - Round-trip verified (connect -> token stored under company scope -> Cliq message round-trips).

  **Blocked by [“T1 — Extract shared per-company connection module”] (T1).**

  </details>

### T5 — Docs + reinstall re-verification for tenant-facing multitenancy

- **Hierarchy:** Move token storage to per-company (multitenant) › T5 — Docs + reinstall re-verification for tenant-facing multitenancy
- **Parent:** “Move token storage to per-company (multitenant)”
- **Status:** blocked  →  set **blocked**
- **Original owner (role):** DevOps & Infrastructure
- **Recommended owner:** DevOps & Infrastructure (same role, recipient's own individual)
- **Priority:** medium
- **Blocked by (create/link first):** “T2 — Agent Channels: tenant-facing connect surface” (blocked); “T3 — Project Bridge: adopt per-company connection pattern” (blocked); “T4 — Knowledge Bridge: tenant-facing connect surface” (blocked)
- **Related context (not recreated under this task):** “Reinstall re-verification smoke-test script”

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  ## T5 — Docs + reinstall re-verification for tenant-facing multitenancy

  Part of the [“Move token storage to per-company (multitenant)”]”) multitenant initiative. Extends [a related task] (reinstall re-verification smoke-test).

  Once the three plugins expose tenant-facing per-company connection (T2/T3/T4) on the shared module (T1), document the end-to-end tenant connect flow and extend the reinstall verification so multitenant config survives plugin reinstall.

  ### Scope
  - Document the tenant **"Connect your org"** flow (link issuance, OAuth `state.companyId` routing, per-company storage) across Agent Channels, Project Bridge, Knowledge Bridge.
  - Extend the [a related task] smoke-test to cover: per-company config persists across reinstall, `/cliq` rewrite + Zoho redirect URI stable, no cross-tenant leakage.
  - Capture the operator vs. tenant surface split in the handoff docs.

  ### Done when
  - Docs published and the reinstall verification covers multitenant per-company config for all three plugins.

  **Blocked by [“T2 — Agent Channels: tenant-facing connect surface”] (T2), [“T3 — Project Bridge: adopt per-company connection pattern”] (T3), [“T4 — Knowledge Bridge: tenant-facing connect surface”] (T4).**

  </details>

### Extend channel pattern beyond Zoho Cliq

- **Hierarchy:** Extend channel pattern beyond Zoho Cliq
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** QA & Testing
- **Recommended owner:** QA & Testing (same role, recipient's own individual)
- **Priority:** medium

### Agent Channels

- **Hierarchy:** Agent Channels
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** board-owned (human founder/CEO)
- **Recommended owner:** recipient CEO / board (assign or keep board-owned)
- **Priority:** medium

### First message fail

- **Hierarchy:** First message fail
- **Parent:** *(root of this project)*
- **Status:** cancelled  →  set **do not recreate**
- **Original owner (role):** Executive Assistant to the CEO
- **Recommended owner:** Executive Assistant to the CEO (same role, recipient's own individual)
- **Priority:** medium

### the base platform system instructions

- **Hierarchy:** the base platform system instructions
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** CEO
- **Recommended owner:** CEO (same role, recipient's own individual)
- **Priority:** medium
- **Related context (not recreated under this task):** “Agent Channel the base platform Skills”; “Preventing Agents from Taking down this Cortex”

### Agent Channel the base platform Skills

- **Hierarchy:** Agent Channel the base platform Skills
- **Parent:** *(root of this project)*
- **Status:** backlog  →  set **backlog**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** medium

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  Look at how base-platform handles its skills with the adapters, we need to mimic this in the agent channels plugin so that skills an agent has in base-platform, they also have via channels.

  </details>

### Agents not responding in Cliq Channels

- **Hierarchy:** Agents not responding in Cliq Channels
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** CEO
- **Recommended owner:** CEO (same role, recipient's own individual)
- **Priority:** medium
- **Children (create after this task):** “Part A: Normalize Cliq participation payload in webhook-handler (channel fix)”; “Part B (optional): Forward mentions/channel/operation from Cliq Deluge participation handler”; “Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)”; “Cliq channel reply latency: progress ack + per-turn timing + warm-process”

### Part A: Normalize Cliq participation payload in webhook-handler (channel fix)

- **Hierarchy:** Agents not responding in Cliq Channels › Part A: Normalize Cliq participation payload in webhook-handler (channel fix)
- **Parent:** “Agents not responding in Cliq Channels”
- **Status:** done  →  set **done**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** high
- **Blocks:** “Part B (optional): Forward mentions/channel/operation from Cliq Deluge participation handler” (cancelled)
- **Related context (not recreated under this task):** “Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)”; “Agent Channels”

### Part B (optional): Forward mentions/channel/operation from Cliq Deluge participation handler

- **Hierarchy:** Agents not responding in Cliq Channels › Part B (optional): Forward mentions/channel/operation from Cliq Deluge participation handler
- **Parent:** “Agents not responding in Cliq Channels”
- **Status:** cancelled  →  set **do not recreate**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** low
- **Blocked by (create/link first):** “Part A: Normalize Cliq participation payload in webhook-handler (channel fix)” (done)

### Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)

- **Hierarchy:** Agents not responding in Cliq Channels › Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)
- **Parent:** “Agents not responding in Cliq Channels”
- **Status:** done  →  set **done**
- **Original owner (role):** board-owned (human founder/CEO)
- **Recommended owner:** recipient CEO / board (assign or keep board-owned)
- **Priority:** high
- **Blocked by (create/link first):** “Plugin webhook→async host calls denied by invocation-scope hardening (blocks Cliq channel replies)” (done)
- **Related context (not recreated under this task):** “Part A: Normalize Cliq participation payload in webhook-handler (channel fix)”

### Cliq channel reply latency: progress ack + per-turn timing + warm-process

- **Hierarchy:** Agents not responding in Cliq Channels › Cliq channel reply latency: progress ack + per-turn timing + warm-process
- **Parent:** “Agents not responding in Cliq Channels”
- **Status:** in_review  →  set **in_review**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** high
- **Children (create after this task):** “Warm/pooled Cliq harness process (eliminate cold subprocess per turn)”
- **Related context (not recreated under this task):** “Part A: Normalize Cliq participation payload in webhook-handler (channel fix)”

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  Follow-up from [““Agents not responding in Cliq Channels” Part A: Normalize Cliq participation payload in webhook-handler (channel fix)”]”): channel replies feel slow. Diagnosis (full trace in ““Agents not responding in Cliq Channels” Part A: Normalize Cliq participation payload in webhook-handler (channel fix)” comment `0b959cf0`):

  **Root causes**
  1. **Cold subprocess per turn** — `runAgentChat`→`runHarness`/ACP spawns a fresh CLI every message (`src/lib/harness.ts:822`, ACP `:611`); no warm/pool. Each reply pays binary load + auth + persona-bundle read before model inference.
  2. **No progress feedback in channels** — DM path streams a live card `Waiting→Thinking→tool→answer` (`src/modules/cliq/webhook-handler.ts:732-748`); channel path awaits the whole turn and posts only final text (`:650-702`). Identical turns feel far slower in a channel.
  3. **Follow-ups silently buffered ≤10 min** by the concurrent-query guard in channels (`:457-468`).
  4. **No per-turn timing logged** — `logDone` (`:801`) records length not elapsed, so live latency isn't attributable.

  **Proposed work (in priority order)**
  - [ ] **Channel progress ack**: on a channel turn, immediately post a lightweight "💭 thinking…" message, then edit-in-place / replace with the final answer (mirror the DM card). Removes most *perceived* latency. (smallest, highest UX win)
  - [ ] **Per-turn timing logs**: instrument receipt→spawn→first-token→delivered in `runChatInBackground` + `logDone` so the live server can attribute seconds.
  - [ ] **Warm/pooled harness process** (or keep-alive) to eliminate cold-start — larger change, biggest real-time win; scope after timing data confirms magnitude.
  - [ ] Consider acking buffered follow-ups in channels (currently silent).

  **Verification**: timing logs show reduced time-to-first-visible in a channel; "💭 thinking…" appears within ~1s of an @mention; final answer replaces/follows it.

  Reference old design for warm-process/streaming patterns: `<scratch path>`.

  </details>

### Warm/pooled Cliq harness process (eliminate cold subprocess per turn)

- **Hierarchy:** Agents not responding in Cliq Channels › Cliq channel reply latency: progress ack + per-turn timing + warm-process › Warm/pooled Cliq harness process (eliminate cold subprocess per turn)
- **Parent:** “Cliq channel reply latency: progress ack + per-turn timing + warm-process”
- **Status:** blocked  →  set **blocked**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** medium

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  Child of “Cliq channel reply latency: progress ack + per-turn timing + warm-process” (item 3). Root cause: `runAgentChat`->`runHarness`/ACP spawns a fresh CLI subprocess every message (`src/lib/harness.ts:822`, ACP `:611`) - no warm/pool - so each reply pays binary load + auth + persona-bundle read before model inference.

  **Blocked / do not start yet.** “Cliq channel reply latency: progress ack + per-turn timing + warm-process” deliberately defers this as the larger change to size *after* timing data confirms cold-spawn magnitude.

  **Unblock owner + action:** operator -> deploy/restart the plugin worker so the “Cliq channel reply latency: progress ack + per-turn timing + warm-process” ack+timing change (branch `neo-281-cliq-channel-ack-timing`) is live, then any agent collects the new `[timing]` lines.

  **Unblock path:**
  1. Operator deploys/restarts the plugin worker.
  2. Collect `[timing]` lines from real channel + DM turns (grep `server.log` for `[timing]`): `received->spawn  spawn->firstToken  firstToken->delivered  total`.
  3. If `received->spawn` (cold start) is a material fraction of total, design a warm/pooled or keep-alive harness process. Reference old design for warm-process/streaming patterns: `<scratch path>`.

  **Also captured here (item 4, low priority):** the concurrent-query guard (`webhook-handler.ts` ~`:457-468`) silently buffers channel follow-ups for <=10 min. Consider a lightweight ack (e.g. a reaction) so a buffered follow-up isn't silently dropped - weigh against per-message channel noise.

  </details>

### Plugin webhook→async host calls denied by invocation-scope hardening (blocks Cliq channel replies)

- **Hierarchy:** Plugin webhook→async host calls denied by invocation-scope hardening (blocks Cliq channel replies)
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** critical
- **Blocks:** “Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)” (done)

### Cliq bot: first message doesn't trigger a response (takes two messages)

- **Hierarchy:** Cliq bot: first message doesn't trigger a response (takes two messages)
- **Parent:** *(root of this project)*
- **Status:** backlog  →  set **backlog**
- **Original owner (role):** unassigned / board-owned
- **Recommended owner:** recipient CEO / board (assign or keep board-owned)
- **Priority:** medium
- **Related context (not recreated under this task):** “Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)”; “cortex-beta: register test bots pointed at the beta host”

  <details><summary>Substance (purpose / scope / acceptance / current gate — shape-preserving)</summary>

  ## Cliq bot: first message doesn't trigger a response (takes two)

  Reported by Bernesto during [“cortex-beta: register test bots pointed at the beta host”] — flagged as a **pre-existing, likely-unrelated** bug to fix later.

  **Symptom:** when messaging a Cliq bot, the **first** message often doesn't kick off an agent response; sending a **second** message gets a reply. Suggests the first inbound either only bootstraps the session/connection without dispatching, or the first-message path (e.g. self-selection / broadcast-token handling, channel-history seeding) returns `handled` without invoking the agent.

  **Where to look:** `plugins/agent-channels/src/modules/cliq/webhook-handler.ts` — the DM/mention dispatch path and any "first message in session" branching; cross-check the “Cliq channels: enable broadcast mode + per-channel policy config (“Agents not responding in Cliq Channels” Part C)” self-selection/broadcast silent-token logic.

  **Repro:** message a freshly-idle bot (e.g. `cortexbetatestbot` on beta) and observe whether the first message is answered. Reproduce on live too.

  </details>

### Pull changes

- **Hierarchy:** Pull changes
- **Parent:** *(root of this project)*
- **Status:** done  →  set **done**
- **Original owner (role):** Chief Technology Officer
- **Recommended owner:** Chief Technology Officer (same role, recipient's own individual)
- **Priority:** medium
- **Related context (not recreated under this task):** “Cliq channels: enable broadcast mode + per-channel policy config ((a related task) Part C)”; “cortex-beta: make Agent Channels plugin UI host-agnostic (derive webhook/callback URLs from origin)”; “agent-channels: Cliq streaming reply can't edit-in-place (draft-stream 'no ref returned')”
