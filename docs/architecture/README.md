# TaskDrop architecture diagrams

Four pages drawn from the real code with [Archify](https://github.com/tt-a1i/archify). Open any `.html` file in Chrome (double-click it). Each box lists the file and line it came from; click through to read the code. Pinned to commit `b2b0545` of `redesigned-2.0` (5 Nov 2026).

| Page | Answers |
|---|---|
| [taskdrop-architecture.html](taskdrop-architecture.html) | What are the parts (app, server functions, database, outside services) and how do they connect? |
| [taskdrop-task-lifecycle.html](taskdrop-task-lifecycle.html) | Which statuses can a task be in, and what moves it from one to the next? |
| [taskdrop-money-sequence.html](taskdrop-money-sequence.html) | In what order do the app, the `api` function, the database and RazorpayX talk, from an offer to a withdrawal? |
| [taskdrop-database-erd.html](taskdrop-database-erd.html) | Which core tables exist, with their key columns and how they link? |

The drawings are generated from the small files in `src/` (one per page). Do not edit the `.html` files by hand.

## Refresh them after the code changes

Say to Claude: **"refresh the architecture diagrams"**. Claude re-reads the changed code, edits the matching file in `src/`, and runs Archify again:

```bash
node ~/.claude/skills/archify/bin/archify.mjs finalize architecture src/architecture.json taskdrop-architecture.html --repo-root ../.. --quality showcase
```

(`finalize` runs the checks and fails loudly if a drawing is unreadable. The other types are `lifecycle`, `sequence` and `erd`.)

## Known limits

- The ERD shows key columns only; the full list is in `packages/db-types`.
- The admin panel is a separate repo and is described in a card, not drawn as its own diagram yet.
- Archify checks that the line numbers exist and the drawing is readable. It cannot prove a claim is true: re-check a box against its source when the code matters.
