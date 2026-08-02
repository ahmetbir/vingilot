# Workbench Shell Implementation Plan (Run-primary, live coordinator)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Vingilot Workbench as a running application: Direction B's Run-primary shell (Run rail, workspace tabs, status bar, ⌘K palette, STOP) rendering **live data from the coordinator HTTP API** — create a Run from the UI, watch the reconciler pause it when its wall-clock budget expires, and see the designed control-plane-unreachable state by actually killing the coordinator.

**Architecture:** `vingilot/workbench` (already a pnpm workspace member from the mount spike) is repurposed from spike harness into the real app. The spike's verdict binds this plan: **zero imports from `desktop/src/**`** — the import-edge guard flips from "forbid the app shell" to "forbid all of desktop," and must exit 0 from now on; it is the chat-adapter promise made mechanical. The browser never holds the coordinator auth token: Vite's dev proxy injects it server-side. Tauri packaging and the chat adapter are explicitly later plans.

**Tech Stack:** React 19 + Vite 8 (pinned from the spike), plain CSS custom properties (no UI library, no Tailwind here), Node's `node --test` for unit tests, coordinator's axum API (one new list endpoint, Rust). Playwright **MCP browser tools** for visual verification — not a new package dependency.

## Global Constraints

- Everything under `vingilot/`; `./vingilot/scripts/check-seams.sh` exit 0 before every commit. No new entries expected.
- Branch **`vingilot/workbench-shell`**, created from `vingilot/coordinator`.
- Trailers: `Signed-off-by:` first, then `Co-authored-by:` (ADR-004). Commit via `git commit -F`.
- Never `git commit --amend` another session's commit; stack fixes.
- **No new npm dependencies.** React/Vite/TS are pinned; the shell is plain React + CSS. A dependency added for convenience reopens the spike's single-React guarantees.
- **No imports from `@/` or any `desktop/` path in workbench src.** The guard (Task 1) enforces this; if a task cannot proceed without upstream code, that is a finding to report, not a reason to import.
- All text sizes **rem-based**. No px font sizes, no arbitrary rem drift: use the tokens defined in Task 1.
- Rust side: no `unsafe`, no new `unwrap()`/`expect()` outside `#[cfg(test)]`; coordinator gate (`vingilot/scripts/coordinator-check.sh`) must stay green when coordinator code is touched.
- UI copy rules from the design phase: the word **"isolated" never describes a worktree**; enforced-per-action renders **solid**, process-level renders **dashed**, absent capability renders **nothing** (ADR-003 §Enforced versus observed).

## Design tokens (fixed here; Task 1 writes them verbatim)

From the 8-round design: alpha is the material, chroma lives in the backdrop, semantic hues appear only where they encode state.

```css
:root {
  /* backdrop — the only place chroma lives */
  --vg-gradient-top: #4a4616;
  --vg-gradient-bottom: #0a1423;
  /* achromatic material */
  --vg-panel: hsl(0 0% 10% / 0.92);
  --vg-panel-solid: hsl(0 0% 10%);
  --vg-hover: rgb(255 255 255 / 0.04);
  --vg-active: rgb(255 255 255 / 0.07);
  --vg-border: rgb(255 255 255 / 0.09);
  --vg-fg: rgb(255 255 255 / 0.92);
  --vg-fg-muted: rgb(255 255 255 / 0.5);
  --vg-fg-faint: rgb(255 255 255 / 0.35);
  /* semantic — each hue bound to exactly one state class */
  --vg-sem-write: #e8944a;   /* write grants, scope chips */
  --vg-sem-live: #6aa5e8;    /* RUNNING / live execution */
  --vg-sem-ok: #7dc98f;      /* verified / completed */
  --vg-sem-attn: #e6c85a;    /* BLOCKED / needs-you / stale / paused */
  --vg-sem-stop: #e5484d;    /* STOP / revoke / failed — the only red */
  /* type — rem only */
  --vg-text-base: 0.875rem;
  --vg-text-meta: 0.75rem;
  --vg-text-micro: 0.6875rem;
  --vg-font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  /* radius scale — extracted from the Buzz desktop app (its --radius is
     0.625rem; rounded-full dominates its chip/button usage; rounded-2xl its
     large cards) so the two UIs read as one product. */
  --vg-radius: 0.625rem;      /* standard controls, inputs, rail rows */
  --vg-radius-card: 1rem;     /* Deck cards, Run view panels, palette */
  --vg-radius-sm: 0.5rem;     /* small nested elements */
  --vg-radius-pill: 9999px;   /* chips, STOP, count badges — Buzz's dominant form */
}
```

Chip form rule as CSS classes: `.chip--enforced` (solid 1px border + filled tint) vs `.chip--stated` (dashed 1px border, no fill). Both must be distinguishable in monochrome. **Both are pills** (`--vg-radius-pill`), like every chip in the Buzz app.

**Visual-alignment rule (binding for every UI task):** the Workbench sits next to the existing Buzz app on the same screen and must read as the same product family. Radii come ONLY from the scale above — chips/badges/STOP are pills, cards `--vg-radius-card`, controls `--vg-radius`; do not invent values. Buttons and inputs get visible rounded surfaces (Buzz style), not square boxes. Density stays tighter than Buzz's chat (this is a tool, per the design phase) but corner language and material must match.

## Coordinator API contract consumed (existing unless marked NEW)

```
GET  /v1/workspaces/{id}                          → { revision, state_hash, state }
GET  /v1/workspaces/{id}/runs   (NEW — Task 2)    → { runs: [RunSummary] }
GET  /v1/runs/{id}                                → run + grants + transitions
POST /v1/runs                                     → 201 { run_id }
POST /v1/runs/{id}/transition   { to, reason }    → 200 | 409 {error,detail}
POST /v1/runs/{id}/provision    ProvisionSpec     → 200 | 409
Auth: Authorization: Bearer <token> — injected by the VITE PROXY, never in browser code.
```

`RunSummary` (NEW endpoint's row): `{ id, parent_run_id, objective, mode, status, wall_limit_secs, wall_started_at, tokens_observed, tokens_observed_at, created_at, updated_at }`.

## File Structure

```
vingilot/workbench/
├── vite.config.ts            # + server.proxy /coord → 127.0.0.1:7117 with auth header
├── src/
│   ├── main.tsx              # boots <App/>
│   ├── App.tsx               # 3-region grid: rail | tab area | status bar
│   ├── styles/tokens.css     # the block above, verbatim
│   ├── styles/shell.css      # layout + chip classes
│   ├── api/coordinator.ts    # typed client, ApiResult<T> with 409 payloads
│   ├── api/poll.ts           # usePolling hook: interval + backoff + reachability
│   ├── model/run.ts          # RunStatus/RunMode types, status→semantic-class map,
│   │                         #   rail grouping (needsYou/live/recent), wall-clock math
│   ├── shell/RunRail.tsx     # left rail: groups, mode chips, ⌘1..9 targets
│   ├── shell/StatusBar.tsx   # workspace · run · budget · reachability dot
│   ├── shell/TabArea.tsx     # workspace-level tabs; Deck is home tab
│   ├── shell/StopButton.tsx  # STOP chrome (hold-to-engage 600ms)
│   ├── shell/Palette.tsx     # ⌘K: typed rows (run/cmd), rank: active-run scope first
│   ├── deck/Deck.tsx         # composer bar (objective→Start Run) + card lanes
│   ├── run/RunView.tsx       # Run tab: header chips, budget bars, transitions, actions
│   └── system/Unreachable.tsx# persistent non-dismissible system lane
│   └── *.test.mjs            # colocated node --test units for model/api logic
├── scripts/check-import-edges.mjs   # MODIFIED: forbidden root = entire desktop/src
└── (spike files removed: SpikeHarness.tsx, fixtures/, mount.test.mjs, singletonReach.test.mjs)
vingilot/coordinator/coordinator/src/http.rs   # + list runs endpoint (Task 2)
vingilot/scripts/coordinator-run.sh            # NEW: run the coordinator bin for dev
vingilot/docs/workbench.md                     # Task 7: runbook + screenshots evidence
```

---

### Task 1: Retire the spike, flip the guard, land the tokens

**Files:**
- Delete: `src/SpikeHarness.tsx`, `src/fixtures/timeline.ts`, `src/fixtures/__edgeProbe.tsx`, `src/mount.test.mjs`, `src/singletonReach.test.mjs`, `scripts/check-singleton-reach.mjs`
- Modify: `scripts/check-import-edges.mjs`, `src/main.tsx`, `package.json` (drop `check:singleton-reach` script), `tsconfig.json` (drop the `@/*` path — the alias dies with the spike)
- Create: `src/App.tsx`, `src/styles/tokens.css`, `src/styles/shell.css`, `src/importEdges.test.mjs` (rewritten), `src/fixtures/__edgeProbe.tsx` (recreated, now importing a relative path into `../../../../desktop/src/shared/lib/cn`)

The guard inversion is the point of this task: during the spike, reaching upstream was the experiment; now it is the violation. `FORBIDDEN` becomes the whole of `desktop/src`. The probe fixture proves the guard still catches a violation (via relative path now — the alias is gone, and the guard must catch relative escapes too).

- [ ] **Step 1:** Rewrite `src/importEdges.test.mjs`: test A — `forbiddenEdges(App.tsx)` is `[]`; test B — the probe yields ≥1 violation. Run: FAILS (App.tsx missing, guard still has old roots).
- [ ] **Step 2:** Delete spike files; update `check-import-edges.mjs`: `const FORBIDDEN = [DESKTOP_SRC]`; default entry `src/App.tsx`. Keep `import-graph.mjs` untouched — it already resolves relative imports.
- [ ] **Step 3:** Write `tokens.css` (verbatim block above), `shell.css` (grid: `grid-template-columns: 232px 1fr; grid-template-rows: 1fr 28px`, backdrop `linear-gradient(var(--vg-gradient-top), var(--vg-gradient-bottom))`, panels on `--vg-panel`, `.chip--enforced`/`.chip--stated`), minimal `App.tsx` (empty rail + tab area + status bar placeholders, real layout), `main.tsx` imports both css + App.
- [ ] **Step 4:** `pnpm --filter @vingilot/workbench typecheck && test && check:import-edges` — all green, **guard exit 0 for the first time**. Visual: dev server, confirm gradient backdrop + three regions via browser tools.
- [ ] **Step 5:** Commit `feat(workbench): retire the spike; the adapter promise becomes the import guard`.

---

### Task 2: Coordinator list endpoint (Rust)

**Files:**
- Modify: `vingilot/coordinator/coordinator/src/http.rs`, `src/run.rs`
- Test: `vingilot/coordinator/coordinator/tests/http_api.rs` (append)
- Create: `vingilot/scripts/coordinator-run.sh`

**Interfaces:**
- Produces: `run::list_for_workspace(pool, workspace_id) -> Result<Vec<RunSummaryRow>, RunError>` (ordered `updated_at DESC`, capped `LIMIT 200`) and `GET /v1/workspaces/{id}/runs` returning `{ "runs": [...] }` with the RunSummary fields named above. Same bearer auth as everything else.

- [ ] **Step 1:** Append failing contract test: create workspace + 2 runs (one transitioned to Running), GET the list, assert both rows present, Running row carries non-null `wall_started_at`, order is most-recent-first, and 401 without bearer. Run: red.
- [ ] **Step 2:** Implement `list_for_workspace` (single `query_as` over the `runs` columns) + thin handler. Green.
- [ ] **Step 3:** `coordinator-run.sh`: `#!/usr/bin/env bash; set -euo pipefail;` cd to coordinator, export `COORD_DATABASE_URL` default (5435) and `COORD_AUTH_TOKEN="${COORD_AUTH_TOKEN:-vingilot-dev-token}"`, `COORD_BIND="${COORD_BIND:-127.0.0.1:7117}"`, `exec cargo run -q --bin vingilot-coordinator` (check the actual bin name in Cargo.toml; adjust `COORD_BIND` env support in main.rs if it is currently hardcoded — if you add it, test the parse). chmod +x.
- [ ] **Step 4:** Full `coordinator-check.sh` green; boot via the script, `curl -H "Authorization: Bearer vingilot-dev-token" http://127.0.0.1:7117/v1/workspaces/<id>/runs` returns real JSON. Kill it.
- [ ] **Step 5:** Commit `feat(coordinator): list runs for a workspace, and a dev run script`.

---

### Task 3: Typed API client + polling with reachability

**Files:**
- Create: `src/api/coordinator.ts`, `src/api/poll.ts`, `src/api/coordinator.test.mjs`, `src/model/run.ts`, `src/model/run.test.mjs`
- Modify: `vite.config.ts` (proxy)

**Interfaces:**
- Produces:

```ts
// api/coordinator.ts — every method returns ApiResult<T>, never throws on HTTP errors
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "conflict"; error: string; detail: string; revision?: number }
  | { ok: false; kind: "unreachable" }        // network failure — feeds the system lane
  | { ok: false; kind: "api"; status: number; error: string; detail: string };
export const listRuns: (workspaceId: string) => Promise<ApiResult<RunSummary[]>>;
export const getRun: (id: string) => Promise<ApiResult<RunDetail>>;
export const createRun: (req: NewRunReq) => Promise<ApiResult<{ run_id: string }>>;
export const transitionRun: (id: string, to: RunStatus, reason: string) => Promise<ApiResult<void>>;
export const provisionRun: (id: string, spec: ProvisionSpec) => Promise<ApiResult<void>>;
// base path is "/coord" — the vite proxy owns the real origin and the token

// model/run.ts
export type RunStatus = "draft"|"provisioning"|"ready"|"running"|"verifying"|"paused"|"blocked"|"completed"|"failed"|"cancelled";
export type RunMode = "interactive"|"delegated"|"chat";
export const railGroups: (runs: RunSummary[]) => { needsYou: RunSummary[]; live: RunSummary[]; recent: RunSummary[] };
//   needsYou = paused|blocked; live = running|verifying|provisioning|ready; recent = terminal, newest 10
export const statusClass: (s: RunStatus) => "live"|"ok"|"attn"|"stop"|"muted";
export const wallClock: (r: RunSummary, now: Date) => { spentSecs: number; limitSecs: number|null; exceeded: boolean } | null;
```

- [ ] **Step 1:** Failing units: `railGroups` buckets every one of the 10 statuses (exhaustive — a new status must break this test); `statusClass` total; `wallClock` null when never started, exceeded math at the boundary; client parses a 409 body into `kind:"conflict"` and a `TypeError` fetch failure into `kind:"unreachable"` (spin a throwaway `node:http` server in the test for the 409 case; point the client at it via its optional `baseUrl` param).
- [ ] **Step 2:** Red → implement → green. `poll.ts`: `usePolling(fn, ms)` returns `{ data, reachable, lastOk }`; flips `reachable:false` on `kind:"unreachable"`, keeps last-good `data`, retries on interval (no exponential complexity — fixed 2s, this is a local tool).
- [ ] **Step 3:** Vite proxy in `vite.config.ts`:

```ts
server: {
  port: 5273,
  proxy: {
    "/coord": {
      target: process.env.COORD_URL ?? "http://127.0.0.1:7117",
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/coord/, ""),
      headers: { Authorization: `Bearer ${process.env.COORD_AUTH_TOKEN ?? "vingilot-dev-token"}` },
    },
  },
},
```

The token exists only in the dev-server process. State this in a comment.
- [ ] **Step 4:** Gates green (typecheck, tests, import guard). Commit `feat(workbench): typed coordinator client with honest failure kinds`.

---

### Task 4: The shell — rail, tabs, status bar, STOP, palette

**Files:**
- Create: `src/shell/RunRail.tsx`, `src/shell/TabArea.tsx`, `src/shell/StatusBar.tsx`, `src/shell/StopButton.tsx`, `src/shell/Palette.tsx`, `src/shell/keys.ts`, `src/shell/keys.test.mjs`
- Modify: `src/App.tsx`, `src/styles/shell.css`

Direction B structure, from the accepted mockups (2d/2e): rail groups **NEEDS YOU / LIVE / RECENT** with counts; each row = status glyph + objective + mode chip + progress/status meta. Mode chips per the form rule: `delegated` → `.chip--enforced` labeled `acp`; `interactive` → `.chip--stated` labeled `int`; `chat` → plain `@ chat` (no border — no grants exist). Tab area: workspace-level tabs, `Deck` fixed first; a Run opens as a tab. Status bar: `Vingilot · <workspace> · <active run + status> · <budget> · <sync dot>`. STOP: top-right, `--vg-sem-stop` border, **hold 600ms** to engage (design decision: fast-but-deliberate), engaged state = filled bar across the top; V1 behavior = pause every live run via API, disable New Run until released.

Keyboard (`keys.ts`, pure + testable): `⌘K` palette toggle, `⌘1..9` select nth rail run, `Esc` closes palette/overlay. `resolveKey(evt) -> Action|null` as a pure function.

- [ ] **Step 1:** Failing unit for `resolveKey` (⌘K, ⌘5, Esc, plain k without meta → null, ⌘K while palette open → close).
- [ ] **Step 2:** Red → implement keys → green.
- [ ] **Step 3:** Build the components against `usePolling(listRuns…)` with the dev workspace id (hardcode one `WORKSPACE_ID` const in `App.tsx` with a comment; creating it if absent is Task 5's flow). Empty states designed, not accidental: rail with zero runs shows "no runs — ⌘K or the Deck composer starts one".
- [ ] **Step 4:** Visual verification with the browser tools against real coordinator (run `coordinator-run.sh` in background): rail renders groups; palette opens/closes on ⌘K; STOP hold engages (with zero runs it simply engages and releases). Screenshot evidence for the report. Gates green. Kill background processes.
- [ ] **Step 5:** Commit `feat(workbench): run-primary shell — rail, tabs, status bar, palette, hold-to-stop`.

---

### Task 5: Deck composer + Run creation + provision

**Files:**
- Create: `src/deck/Deck.tsx`
- Modify: `src/App.tsx` (workspace bootstrap), `src/api/coordinator.ts` (only if a gap emerges — report it if so)

Deck (design 2e): composer bar at top — objective input, mode select (`delegated`/`interactive`), wall-limit select (30m/2h/none) — `Start Run` → `createRun` → `provisionRun` with a single task worktree spec (`repo_id:"buzz", target_id:"local", role:"task", access:"write"`, idempotency key = the run id) → run appears in rail LIVE group as `ready`, opens as active tab. Below: three lanes (NEEDS YOU / LIVE / RECENT) as cards, click → open tab. Workspace bootstrap in `App.tsx`: on first load, `GET /v1/workspaces/{WORKSPACE_ID}`; on 404-ish `api` failure, POST a first mutation via the existing mutations endpoint (`ensure` semantics — read http.rs to confirm the ensure path; if the API cannot create a workspace, add that to the coordinator in this task WITH a contract test, and say so in the commit).
- [ ] Steps: failing unit for the provision-spec builder (deterministic idempotency key, ≤1 write grant) → implement → live verification: create a Run from the UI with a 1-minute wall limit, transition it Running from the Run view (Task 6 renders it; for now the rail row click may just open a stub tab — acceptable ONLY if Task 6 follows in the same session), gates, commit `feat(workbench): deck composer creates and provisions real runs`.

---

### Task 6: Run view — chips, budget honesty, transitions, actions

**Files:**
- Create: `src/run/RunView.tsx`, `src/run/BudgetBar.tsx`, `src/run/budget.test.mjs`
- Modify: `src/shell/TabArea.tsx`

The design's budget-honesty rules become components: wall clock = **solid** meter (`enforced — pauses at cap`), tokens = **dashed** meter prefixed `≈` with `(observed · lag)` caption and **no meter at all when `tokens_observed_at` is null** (a capability with no data renders nothing, not zero). Header: status chip (semantic class), mode chip (form rule), objective, run id. Transitions list (from `getRun`): `seq · from → to · reason · at`, newest first. Actions row by current status (legal edges only — derive from a `legalNext(status)` map mirroring the domain table; illegal actions are ABSENT, not disabled): Ready→`Start`, Running→`Pause`/`Cancel`, Paused→`Resume`/`Cancel`, etc. A 409 from an action shows the server's `detail` inline next to the button row (data-carrying conflicts get shown, not toasted away).
- [ ] Steps: failing units (`legalNext` exhaustive over 10 statuses vs the domain table copied into the test; BudgetBar render-model: given run rows → `{wall: {pct,label}|null, tokens: {label}|null}` incl. the null-cases) → implement → **live end-to-end: create run with 1m limit → Start → watch reconciler… wait, the reconciler only runs inside `run_reconciler` when the coordinator bin starts it; confirm main.rs spawns it (read the code; if it does not, add it in this task with the interval at 5s and note it in the commit)** → after the limit, rail row moves to NEEDS YOU as `paused`, Run view shows the `wall clock budget exhausted` transition row. Screenshot that moment — it is the plan's money shot: the enforceable budget, enforced, visibly. Gates, commit `feat(workbench): run view with honest budgets and legal-edges-only actions`.

---

### Task 7: The unreachable lane + runbook

**Files:**
- Create: `src/system/Unreachable.tsx`, `vingilot/docs/workbench.md`
- Modify: `src/App.tsx`, `src/styles/shell.css`

Design 7c, faithfully: when `reachable` flips false — a **persistent, non-dismissible** row above the status bar: `⚠ CONTROL PLANE UNREACHABLE — read-only since <t> · new Runs and transitions queue nothing (V1: they are disabled) · retrying · next in <n>s` + `Retry now`. Rail keeps last-good data, every row stamped `as of <t>`; composer and action buttons disabled with the reason inline. It clears itself on reconnect. V1 queues nothing — **disabled is honest, a fake queue is not** (ADR-002 queued-write pinning is client work deferred with the adapter).
- [ ] Steps: unit for the countdown/reachability reducer → implement → live: kill the coordinator process, watch the lane appear with ticking retry, restart coordinator, watch it clear; screenshot both states → `docs/workbench.md`: how to run (3 commands: stack, coordinator-run.sh, pnpm dev), what works, what is deferred (chat adapter, Tauri packaging, queued writes, per-mode token caps), screenshots embedded, and the guard's role as the adapter promise → gates → commit `feat(workbench): the control plane can vanish and the shell says so`.

---

## Self-Review

**Design coverage:** Direction B rail/tabs/status bar (T4), Deck composer (T5), Run view with solid/dashed budget honesty and absent-not-disabled actions (T6), unreachable-as-structure (T7), STOP hold-to-engage (T4), keyboard model start (T4). Deliberately deferred and recorded in `workbench.md`: chat adapter + channel tabs, terminal/PTY surface, multibuffer diff, Deck membership sync, Tauri packaging, queued writes. **Spike conformance:** the flipped guard (T1) makes "zero desktop imports" permanent CI. **ADR conformance:** budget rendering per ADR-002/003 amendments; legal-edge actions mirror the domain table; STOP pauses via legal transitions only.

**Placeholders:** none; interfaces are typed above, CSS tokens verbatim, endpoint shape fixed. Two conditional additions (workspace-create path in T5, reconciler spawn in T6) are explicit read-then-decide instructions with test obligations, not gaps.

**Type consistency:** `RunStatus`/`RunMode` string unions match the coordinator's SQL CHECK strings (Task 2's rows are the same strings); `ApiResult` kinds consumed by `usePolling` (T3) and `Unreachable` (T7); `railGroups` output consumed by `RunRail` (T4) and `Deck` lanes (T5).
