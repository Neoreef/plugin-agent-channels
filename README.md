Agent Channels is a Paperclip plugin that connects users to Paperclip agents and issues through the communication platforms they already work in. Paperclip is a governance architecture that manages work for agents by tracking goals, projects, and issues — but it lacks the surfaces users need to engage with it inside their own workflows. Agent Channels closes part of that gap, providing an integration point for popular messaging platforms such as Zoho Cliq, Microsoft Teams, Google Chat, and Slack.

The plugin draws on each agent's identity, harness/model configuration, and memory (e.g. Honcho) to route a user's message directly to the right agent and stream the reply back into the channel — giving users a natural, conversational interface to their agents and the work Paperclip governs.
## Releasing (built `dist/` is committed)

This plugin is installed on the fleet as a package from a pinned git ref:

```
pnpm paperclipai plugin install github:Neoreef/<repo>#<ref>
```

The server's package-install path runs `npm install --ignore-scripts`, so it **does
not build** — the pinned ref must already contain built output under `dist/`. For
that reason `dist/` is **committed to this repo** (it is intentionally *not*
gitignored) and listed in `package.json` `files`, mirroring the honcho plugin.

**Convention (Option A, honcho-shape — NEO-311): every release must rebuild and
commit `dist/`.** Before tagging/pinning a release ref:

1. `npm install` (or `pnpm install`)
2. `npm run build` — regenerates `dist/` (manifest + worker + ui)
3. commit the updated `dist/` on the release branch
4. the resulting commit SHA is the ref the fleet manifest pins

Skipping the rebuild ships stale output to the fleet.
