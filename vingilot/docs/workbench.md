# Runs — the Vingilot surface inside Buzz desktop

Per ADR-001's 2026-08-03 Reversal, Vingilot's UI lives **inside the Buzz
desktop app**, not in a sibling application. The former standalone Workbench
(`vingilot/workbench`) is deleted; its logic modules and tests were ported
into the island and its history remains on the `vingilot/workbench-shell`
branch.

## Where things live

- **Island (fork-owned, additive):** `desktop/src/features/runs/**`
  - `lib/` — coordinator client, polling, run model, budget/legalNext,
    provision spec, reachability. All pure modules carry their `.test.mjs`
    next to them; desktop's own `pnpm test` glob runs them.
  - `ui/` — `RunsScreen` (list pane + Deck pane / Run detail), `RunList`,
    `DeckPane`, `RunDetail`, `BudgetBar`, `StopAllButton` (hold-to-engage),
    `UnreachableBanner`, `RunsLoadingFallback`.
- **Touch-points (declared in `vingilot/seams.yaml`):** the sidebar nav entry
  and the `/runs` route registration. Kept to a few lines each — these are
  the files upstream merges can conflict on.
- **Coordinator:** unchanged except a localhost-allowlist CORS layer so the
  webview can call `http://127.0.0.1:7117` directly.

## Run it

```bash
docker compose up -d                     # postgres/redis/minio (vingilot-isolated stack)
./vingilot/scripts/coordinator-run.sh    # control plane on 127.0.0.1:7117
just dev                                 # Buzz desktop — "Runs" in the sidebar
```

The Runs screen polls the coordinator; killing the coordinator surfaces the
persistent unreachable banner (read-only, `as of <t>` stamps, disabled
composer with the reason inline) and recovers on its own when it returns.

## Honest notes

- The dev bearer token is a constant in webview code (`lib/coordinatorClient.ts`)
  — acceptable for a localhost-only control plane in V1; the follow-up is a
  Tauri-side proxy holding the token in the keychain.
- Wall-clock budgets are enforced (solid meter — the reconciler pauses the
  run); token counts are observed only (dashed `≈`, absent entirely when no
  data exists). Illegal transitions are absent from the DOM, not disabled.
- No global ⌘K in the Runs screen — Buzz owns that shortcut for search.

## Deferred

Chat adapter tie-in (Runs ↔ channels), terminal/PTY surface for interactive
Runs, multibuffer diff review, Tauri-proxied coordinator auth, per-mode token
budget enforcement (needs the executor/broker — see `coordinator.md`'s
deferred gaps).
