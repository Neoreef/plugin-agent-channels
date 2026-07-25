# Cross-Company Migration Handoff — Agent Channels

This folder is a **standalone, cross-company handoff** for the `plugin-agent-channels` project. It exists so a
peer company taking over ownership can reproduce this project's full task tree on its **own board**
without any access to the source company's agents, task IDs, artifacts, credentials, or history.

## What's here

- `HANDOFF-plugin-agent-channels.md` — the executable, self-contained handoff for this project: every task by
  **name and hierarchy position** (never by internal ID), each with its **current status**, its
  original and recommended **role-based** owner, and all parent/child and cross-task dependency
  links. Walk it top-down and recreate parents before children.
- The **master cross-project index** lives in the `cortex-core` repo at `handoff/HANDOFF-index.md`,
  and is also attached to the source company's migration issue.

## How to use it

1. Read `HANDOFF-plugin-agent-channels.md` top to bottom.
2. On your own board, recreate each task by name in tree order (parents before children).
3. Set each task's status to the target status stated in the doc
   (`done→done`, `backlog→backlog`, `blocked→blocked`, `in_review→in_review`, `todo→todo`;
   `cancelled` tasks are historical context and are **not** recreated).
4. Recreate blocker/dependency links by name **before** marking anything `blocked`.
5. Assign each task to the parallel **role** named in the doc (your company's individual for that
   role, not the source company's person).

Roles, not names. Names + hierarchy, not IDs. Nothing here references anything you can't
independently obtain.

