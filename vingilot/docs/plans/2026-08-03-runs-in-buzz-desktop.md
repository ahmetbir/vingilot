# Runs Inside Buzz Desktop — Port Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute ADR-001's 2026-08-03 Reversal, shape (a): the Workbench's Runs functionality moves **into the Buzz desktop app** as a fork-owned island — a `Runs` sidebar entry opening a Runs screen (Deck composer + run list + Run view) in the main pane, live against the coordinator. The sibling app is then deleted.

**Architecture:** One island directory `desktop/src/features/runs/**` (new files only — cannot merge-conflict), plus the **fewest possible touch-points** to shared upstream files (sidebar nav + route registration), every one declared in `vingilot/seams.yaml`. The island imports upstream `shared/ui`/`shared/lib` freely — that is the point of being inside the app — but upstream files never import the island except at the declared touch-points. Coordinator gains a localhost-only CORS layer so the webview can call it directly.

**Tech Stack:** Buzz desktop's own: React 19 + Tailwind (stock rem tokens ONLY — `pnpm check:px-text` gates), biome, `node --test` for `*.test.mjs` (desktop's `pnpm test` glob picks the island's tests up automatically), file-size ratchet applies. Rust: coordinator CORS middleware, hand-rolled (no new dependency).

## Global Constraints

- Branch **`vingilot/runs-in-desktop`** from `vingilot/workbench-shell`. Trailers per ADR-004; `git commit -F`; never amend; never `git add -A`.
- **Every changed path outside `vingilot/` must be in `vingilot/seams.yaml` BEFORE the commit** — `./vingilot/scripts/check-seams.sh` exit 0 gates every commit. Island glob + individually-listed touch-points; if a task needs a new touch-point the plan didn't list, that is a decision: declare it, justify it in the commit body, keep it minimal.
- Desktop gates for anything under `desktop/`: `cd desktop && pnpm check && pnpm typecheck && pnpm test` (biome + ratchet + px-text + pubkey + units). Coordinator gate for Rust: `./vingilot/scripts/coordinator-check.sh` with `COORD_DATABASE_URL=postgres://buzz:buzz_dev@localhost:5435/vingilot_coordinator`.
- **Match Buzz's component idiom**: stock Tailwind rem tokens (`text-sm`, `text-xs`, `text-2xs`), `rounded-full` chips / `rounded-lg` controls / `rounded-2xl` cards, `bg-muted`/`text-muted-foreground`-style semantic classes — read neighbouring features (`desktop/src/features/agents/ui`) and imitate. The design's form rule survives translation: enforced = solid border chip, stated = `border-dashed` chip, absent capability renders nothing; the word "isolated" never describes a worktree.
- Keyboard: **no global ⌘K** (Buzz owns it for search). Screen-local keys only.
- Visual verification: `just desktop-screenshot --name runs --route /runs` (the E2E mock-bridge harness handles boot); run the real coordinator first via `./vingilot/scripts/coordinator-run.sh` — the island talks to `http://127.0.0.1:7117` directly, so real runs render even under the mock bridge. Kill started processes.
- Auth note, stated honestly: the dev bearer token moves into webview code as a dev-only constant (the vite-proxy trick died with the sibling app). Acceptable for a localhost coordinator in V1; the comment must say so and name the follow-up (Tauri-side keychain-backed proxy).

## Source map (donor → destination)

| Donor (`vingilot/workbench/src/`) | Destination (`desktop/src/features/runs/`) | Port notes |
|---|---|---|
| `api/coordinator.ts`, `api/poll.ts` + tests | `lib/coordinatorClient.ts`, `lib/usePolling.ts` + tests | baseUrl `http://127.0.0.1:7117`; keep ApiResult kinds incl. `unreachable` (502/503/504 mapping) |
| `model/run.ts`, `run/budget.ts`, `deck/provisionSpec.ts`, `system/reachability.ts` + tests | `lib/{runModel,budget,provisionSpec,reachability}.ts` + tests | pure logic — ports verbatim; tests are the regression net for the restyle |
| `shell/RunRail.tsx` | `ui/RunList.tsx` | becomes the list pane INSIDE the Runs screen (not app chrome) |
| `deck/Deck.tsx` | `ui/DeckPane.tsx` | composer + lanes, Tailwind restyle |
| `run/RunView.tsx`, `run/BudgetBar.tsx` | `ui/RunDetail.tsx`, `ui/BudgetBar.tsx` | Tailwind restyle; keep legal-edges-only actions + inline 409 detail |
| `shell/StopButton.tsx` | `ui/StopAllButton.tsx` | lives in Runs screen header; **fix the hold bug**: use pointer events with `setPointerCapture`, timer on `pointerdown`, cancel on `pointerup`/`pointerleave`; verify by actually holding in the browser |
| `system/Unreachable.tsx` | `ui/UnreachableBanner.tsx` | scoped to the Runs screen, not global chrome |

Touch-points (the ONLY upstream files edited, all declared in seams.yaml):
1. The sidebar component that renders Inbox/Agents entries — one nav item `Runs`.
2. The route registration for the main pane — one route `/runs` → `RunsScreen`.
3. (Only if routing genuinely requires it) one import line in the route table's parent. Nothing else; in particular `AppShell.tsx` (at its ratchet limit) is not grown — if the nav lives there, add the entry via the smallest possible diff and declare it.

---

### Task 1: Seams, island lib port, coordinator CORS

**Files:**
- Modify: `vingilot/seams.yaml` (island glob `desktop/src/features/runs/*` + the touch-point files found by reading the nav/routing code — declare them NOW even though Task 2 edits them)
- Create: `desktop/src/features/runs/lib/{coordinatorClient,usePolling,runModel,budget,provisionSpec,reachability}.ts` + their `.test.mjs` files (ported, import paths adjusted)
- Modify: `vingilot/coordinator/coordinator/src/http.rs` (CORS), `tests/http_api.rs` (CORS contract tests)

- [ ] **Step 1:** Read `desktop/src/features/navigation`/sidebar + routing to identify the exact touch-point files; write the seams.yaml entries (island glob `status: permanent`, touch-points individually with reasons). Run check-seams — still exit 0 (nothing outside vingilot/ changed yet).
- [ ] **Step 2:** Port the six lib modules + tests. Adjust: client baseUrl constant `const COORD_BASE = "http://127.0.0.1:7117"` and dev token constant with the honesty comment. `cd desktop && pnpm test` — ported tests run green under desktop's own runner. `pnpm typecheck` green (desktop tsconfig is stricter; fix what it flags).
- [ ] **Step 3 (TDD, Rust):** failing CORS contract tests: `OPTIONS /v1/runs` with `Origin: http://localhost:1420` → 204 with `access-control-allow-origin` echoing the origin, `access-control-allow-headers` including `authorization, content-type`; same for a real GET; an origin NOT on the allowlist (`http://evil.example`) gets NO cors headers. Allowlist: `http://localhost:1420`, `http://127.0.0.1:1420`, `tauri://localhost`, plus the 5273 pair while the sibling app still exists. Implement as a small axum middleware in http.rs — no new crate. Green; coordinator gate green.
- [ ] **Step 4:** check-seams 0; commit `feat(runs): island lib ported into desktop; coordinator speaks CORS to the webview`.

---

### Task 2: The Runs screen + the two touch-points

**Files:**
- Create: `desktop/src/features/runs/ui/{RunsScreen,RunList,DeckPane,RunDetail,BudgetBar,StopAllButton,UnreachableBanner}.tsx`
- Modify: the two declared touch-point files (nav entry + route), nothing else outside the island

- [ ] **Step 1:** Read a neighbouring feature screen (`features/agents`) end to end first — layout container, header pattern, list styling, empty states. The Runs screen must look native next to it.
- [ ] **Step 2:** Build `RunsScreen`: left = `RunList` (NEEDS YOU / LIVE / RECENT via ported `railGroups`), right = `DeckPane` when nothing selected / `RunDetail` when a run is selected; header carries `StopAllButton`; `UnreachableBanner` renders above the list when `reachable` is false, with the `as of <t>` stamps and disabled-with-reason composer/actions exactly as the sibling app had. Chips: `rounded-full`, enforced=solid border, stated=`border-dashed`, chat=no chip. Budget: wall solid meter, tokens dashed `≈` chip, nothing when no data.
- [ ] **Step 3:** Wire the two touch-points (smallest possible diffs — a nav item and a route). If either file is ratchet-capped, put the entry in the smallest legal location and note the diff size in the commit body.
- [ ] **Step 4:** Fix STOP properly while porting `StopAllButton` (pointer capture per the source map note) and prove it: hold < 600ms → nothing; hold ≥ 600ms → engaged (pauses every live run via API, button shows engaged state until release).
- [ ] **Step 5:** Gates: `pnpm check && pnpm typecheck && pnpm test` (ratchet + px-text will catch idiom violations); check-seams 0. Visual: coordinator up, `just desktop-screenshot --name runs --route /runs`; then a live browser pass (desktop-dev or the screenshot harness with `--click`) driving: create run → start → pause; screenshot evidence. Kill processes.
- [ ] **Step 6:** Commit `feat(runs): the Runs screen inside Buzz desktop — nav entry, deck, run detail, working stop`.

---

### Task 3: Delete the sibling app; docs truth pass

**Files:**
- Delete: `vingilot/workbench/` entirely
- Modify: `pnpm-workspace.yaml` (remove the member line — this RESTORES the upstream file), `vingilot/seams.yaml` (drop the pnpm-workspace entry if the file is now byte-identical to upstream; keep pnpm-lock's entry, the lockfile still differs), `vingilot/docs/workbench.md` (rewrite: where Runs lives now, the 2-command runbook — coordinator-run.sh + just dev — what is deferred), `vingilot/docs/local-dev.md` (Runs section pointer)

- [ ] **Step 1:** `git rm -r vingilot/workbench`; remove the workspace member line; `pnpm install` (lockfile updates); confirm `git diff upstream/main -- pnpm-workspace.yaml` is empty and delete its seam entry if so.
- [ ] **Step 2:** Docs rewrite; every claim in workbench.md must be true of the DESKTOP app now (screenshots from Task 2's evidence).
- [ ] **Step 3:** Full gates: desktop suite, coordinator gate, check-seams 0. Commit `chore(vingilot): retire the sibling app — Runs lives in Buzz desktop now`.

---

## Self-Review

**Reversal coverage:** island + touch-point seam classes (T1), the in-app screen (T2), sibling-app deletion incl. seam shrinkage (T3). **What deliberately does not change:** coordinator semantics (only CORS added), the ported logic modules (tests port with them and stay the regression net), ADR-002/003 rendering rules (form rule, budget honesty, absent-not-disabled all re-asserted in T2). **Known accepted costs, restated:** dev token in webview code (commented, follow-up named), two shared-file touch-points that will see upstream merge conflicts, no global ⌘K.

**Type consistency:** ported module names change path but not exports; `RunsScreen` consumes `railGroups`/`legalNext`/`budgetView`/`unreachableView` under identical signatures — the ported `.test.mjs` files enforce this before any UI exists.
