# ADR-001 — Product composition and the upstream boundary

- **Status:** Proposed (blocks Phase 0 exit)
- **Date:** 2026-08-01
- **Supersedes:** the unresolved tension between K1/K2 and K4 in the architecture proposal
- **Related:** ADR-002 (control-plane authority), ADR-003 (trust and execution boundary)

## Context

The product is built on a fork of `block/buzz`. Two proposal decisions pull in
opposite directions:

- **K1/K2** — stay connected to upstream, integrate by regular merge, apply
  additive discipline, do not delete upstream code.
- **K4** — the Workbench is the main application shell; Deck is a Home view.

Upstream's desktop shell is a chat application: channel sidebar, timeline,
composer. Converting that chrome into a Workbench is not an additive change. It
is a rewrite of exactly the files upstream touches most, which means K2 fails
precisely where the product's identity lives.

Observations verified against the tree at `19d57b0d4`:

| Claim | Verified |
|---|---|
| `pnpm-workspace.yaml` packages | `desktop`, `web`, `admin-web` — no chat package |
| Chat slices are consumable packages | No. One `index.ts` barrel exists across all of `desktop/src/features/**` |
| Shell centralizes app/feature dependencies | `desktop/src/app/AppShell.tsx` is 999 lines |
| That shell can absorb Workbench chrome | No. The desktop file-size ratchet caps growth; the file is one line under the limit and **may not grow** |
| Import alias scope | `@/*` maps to `./src/*` — desktop-local, not workspace-wide |

The last row is the load-bearing one. A sibling application that alias-imports a
chat slice must replicate desktop's `@` → `desktop/src` mapping, and therefore
pulls in desktop's transitive module graph — provider hierarchy, community-scoped
module singletons, and the reset machinery those singletons require. Compiling is
not the same as mounting.

The dependency direction implied by the proposal is that Buzz becomes a feature of
the product. A component you own as a feature is embedded, not forked.

## Decision

> ### Reversal — 2026-08-03: the Workbench moves INTO the Buzz desktop app
>
> **Owner decision.** The original product brief said it plainly (K4:
> "the Workbench is the main shell"; the owner's own words: *"we are
> transforming buzz"*). This ADR chose a sibling application instead, to
> minimise the upstream merge surface — an engineering priority the owner has
> now explicitly overruled after seeing both apps side by side: **one
> application, and it is Buzz desktop, modified in place.** Decisions 2 and 3
> below are superseded as follows; everything else in this ADR stands.
>
> - **Vingilot's UI is the Buzz desktop app.** Run rail, Deck, Run views, and
>   everything the Workbench built land as new feature islands inside
>   `desktop/src/` (e.g. `desktop/src/features/runs/**`) plus narrow declared
>   touches to navigation/routing/shell.
> - **Two seam classes now exist.** *Islands*: whole new fork-owned
>   directories inside the upstream tree — additive, cannot merge-conflict,
>   declared as directory globs in `seams.yaml`. *Touch-points*: edits to
>   shared upstream files (nav, routing, package.json) — the expensive kind,
>   kept few, each declared individually.
> - **The accepted cost is recorded, not hidden:** upstream merges will now
>   conflict on the touch-point files at upstream's observed velocity
>   (~850 commits/month), and the desktop file-size ratchet constrains which
>   shell files can grow (`AppShell.tsx` sits at its limit). This is the
>   price of one app, knowingly paid.
> - **What transfers:** the coordinator survives untouched (UI-agnostic by
>   construction); the mount spike's verdict is NOT invalidated — it measured
>   pulling chat *out* into a foreign shell, and mounting new views *inside*
>   the app has none of those failures (providers, QueryClient, and singleton
>   lifecycles all exist natively there); the sibling app
>   (`vingilot/workbench`) becomes donor code — its API client, models,
>   render-model logic, and tests port over — and is deleted once the port
>   lands.

1. **One physical monorepo; the layer boundary is logical.** The fork is not split
   into multiple repositories.

2. ~~**Upstream Buzz desktop is preserved as an upstream-owned chat client.**~~
   *Superseded by the 2026-08-03 reversal above.*

3. ~~**The Workbench is a new sibling application.**~~
   *Superseded by the 2026-08-03 reversal above.*

4. **Coordinator and executors are new services/modules**, not modifications of
   existing crates.

5. **All fork-owned code and documentation live under a single root: `vingilot/`.**

6. **Upstream touches are confined to a declared seam inventory.** Relay, core,
   db, SDK, and ACP changes are permitted only at paths listed in
   `vingilot/seams.yaml`, each with a marker comment and a reason. CI fails on any
   diff outside `vingilot/` that is not in the inventory. This converts K2 from an
   intention into a machine-checked rule.

7. **Chat reuse mechanism: the narrow chat adapter, per the Phase 0 spike's
   fallback clause below.** Alias-import in place was the default hypothesis and
   was spiked to a decision, not an assumption. The Phase 0 spike (see
   [`../spike-report.md`](../spike-report.md) and Spike result, below) found
   `MessageTimeline`'s mount reaches `desktop/src/app/**` two hops deep through
   `MessageRow` → `shared/ui/markdown`, and drags in 10 of 20 community-scoped
   singletons — both violations of this ADR's own exit criteria, and neither
   fixable without upstream editing files this ADR forbids editing. The Workbench
   therefore consumes chat through a fork-owned adapter that talks to the same
   relay/SDK APIs and renders its own presentation, accepting duplicated UI
   rather than the merge/leak surface the spike measured. Extraction (moving
   upstream files into new packages) remains rejected regardless — it creates
   the largest possible merge surface, which is the outcome K1 exists to avoid.

8. **Reuse is a Phase 0 spike with a defined fallback, not an assumption.**

### Phase 0 spike — exit criteria

Mount a message list and a composer inside the new Workbench shell such that:

- the Workbench has no import edge to `desktop/src/app/**` or the sidebar shell;
- the mounted slices render and accept input without booting upstream's full
  provider hierarchy;
- every community-scoped module singleton the mounted subtree touches is either
  not reachable, or is registered with the Workbench's own reset path.

**If satisfying this requires broad surgery on upstream UI, the spike fails and we
do not force package extraction.** The fallback is a narrow chat adapter: a
fork-owned component that talks to the same relay/SDK APIs and renders our own
message view, accepting duplicated presentation rather than a large merge surface.

### Spike result

**Fallback taken.** Executed 2026-08-02 at commit `066e4dd9f2c242d0129ede030bce303f4cf84003`
on `vingilot/workbench-mount-spike`. Full evidence: [`../spike-report.md`](../spike-report.md).

Criterion 2 (no import edge to `desktop/src/app/**`) failed mechanically:
`MessageTimeline` reaches `AppShellContext` and `app/navigation/**` two hops
deep, through `MessageRow` → `shared/ui/markdown` → a config-nudge component —
invisible to a direct-import read, caught only by the transitive walker built
for this spike. Criterion 3 (community-scoped singleton reach) showed 10 of 20
registered singletons reachable, three times the threshold set in the plan
before the number was known. Criterion 1 additionally failed at runtime
(missing `QueryClientProvider`, blank page) but was not the deciding factor —
criterion 2 alone disqualifies the mount, since fixing it would mean upstream
editing `MessageRow`/`shared/ui/markdown` to drop the app-scoped navigation
dependency, which decision 7 forbids as an upstream edit that invalidates the
spike. Churn on the exact mounted surface was 5 files in one day, corroborating
the plan's stated maintenance concern independent of the pass/fail result.

Decision 7 and the alternatives below are updated accordingly: alias-import is
no longer the default mechanism; the narrow chat adapter is.

### Dependency direction

`Workbench → Buzz platform/chat capability`. Never the reverse. No upstream file
may import from `vingilot/`.

### Naming, and the branding boundary

The product is **Vingilot**. The name is settled and this ADR is the record of it;
nothing downstream should describe it as provisional.

**We brand the product, not the platform.** Upstream identifiers keep upstream
names. This is a direct consequence of K1 — a rename is a diff, and a diff on a
path upstream also edits is a merge conflict.

| Carries the Vingilot name | Keeps upstream naming |
|---|---|
| Application name, window chrome, dock/taskbar entry | Crate names (`buzz-relay`, `buzz-core`, …) |
| Bundle identifier, installer, auto-update feed | Rust module paths (`buzz_core`, `buzz_acp`) |
| Icon and all brand assets | CSS custom properties (`--buzz-*`) |
| The Workbench application — all new code under `vingilot/` | The `buzz://` scheme (ADR-003 §Resource identity) |
| Coordinator and executors — new services | Upstream's desktop client, which we preserve and do not ship |
| The domain model: Workspace, Run, WorktreeBinding, ProjectRoot | Wire formats and event kinds |
| Documentation and user-facing copy | |

Note what the right column has in common: **none of it is a surface the owner
sees.** Note what the left column has in common: most of it is new code, which is
born with the product's name and requires no rename at all.

Two identifiers sit on the line. Both are resolved by an alias at the seam, never
by a rename at the source — each is a small module under `vingilot/` and produces
zero upstream diff:

- **The `buzz` CLI binary.** A `vingilot` entry point wraps it. Note that this CLI
  is the *agent-facing* interface — agents invoke it, the owner does not — so the
  branding pressure here is weaker than it first appears.
- **`BUZZ_*` environment variables.** Read `VINGILOT_*` first, fall back to
  `BUZZ_*`.

**This boundary needs no new enforcement mechanism.** Renaming an upstream path is
a diff outside `vingilot/`, so the seam-inventory CI rule in decision 6 already
fails it. A rebrand that reaches the platform cannot land quietly.

## Consequences

- Two Tauri applications are built and shipped from one repository. Build,
  release, and CI configuration must handle both.
- Upstream refactors surface as build failures in the Workbench rather than as
  merge conflicts. This is the intended trade: loud, local, and cheap.
- The Workbench inherits upstream's transitive module graph wherever it imports a
  slice. Every module-level cache or singleton reachable from a mounted slice is a
  potential cross-context leak and must be enumerated during the spike.
- We accept presentation duplication as the failure mode of last resort, rather
  than accepting merge cost.
- The seam inventory becomes a review artifact: any PR that adds an entry to
  `vingilot/seams.yaml` is a decision, not a detail.

## Alternatives considered and rejected

**A0. Alias-import upstream chat slices in place (the Phase 0 spike hypothesis).**
Rejected, on spike evidence rather than on taste — see Spike result, above, and
[`../spike-report.md`](../spike-report.md). Compiling is not the same as
mounting: `MessageTimeline`'s 22 direct imports never touch `@/app/`, matching
this ADR's original baseline, but the transitive graph does, two hops down
through `MessageRow` → `shared/ui/markdown`. The mount also reaches 10 of 20
community-scoped singletons with no Workbench-owned reset path for any of
them. Both are structural properties of the upstream component tree, not
defects in the harness, and both would require upstream edits this ADR's
decision 7 forbids as invalidating. The accepted mechanism is now the narrow
chat adapter named in the Phase 0 spike's original fallback clause.

**A. Convert the upstream desktop shell into the Workbench.**
Rejected. It breaks K2 at the exact point where the product differentiates, and it
is mechanically blocked today: `AppShell.tsx` is at 999 lines against a 1000-line
ratchet, so the file cannot grow without either splitting upstream code (a large
non-additive diff) or raising the limit (which the repository's own guidance
forbids).

**B. Extract chat into shared packages, then consume them.**
Rejected. Extraction means moving upstream files, which maximises the merge surface
— the opposite of the goal. Every subsequent upstream change to those files becomes
a manual conflict.

**C. A separate repository consuming Buzz as a published dependency.**
Rejected. No publishable packages exist; creating and operating a publishing
pipeline for upstream code we do not control is more expensive than the monorepo,
and it does not remove the coupling — it only makes it slower to observe.

**D. Total rebrand — rename every upstream identifier to the product name.**
Rejected on measurement, not on taste. Measured against upstream at `19d57b0d4`:

| | |
|---|---|
| Files containing `buzz` | 1,486 |
| Total occurrences | 19,088 |
| Paths with `buzz` in the name | 54, including 27 crates |
| Upstream commits in the preceding 30 days | 850 |
| Files upstream touched in that window | 2,535 |
| **…of those, files containing `buzz`** | **1,189** |

A total rename would therefore produce on the order of **1,189 conflicted files
per month** — and not conflicts git can resolve, because rewriting file contents
alongside the rename degrades the similarity index that rename detection depends
on, and every surviving hunk containing the word disagrees by construction.

That cost is the smaller objection. The larger one: a total rebrand is a hard
fork, and a hard fork **invalidates this ADR's entire structure.** The seam
inventory, the CI rule, the alias-import mechanism, and the decision to preserve
upstream's desktop client all exist to keep merges cheap. With no merges, none of
them have a reason to exist — and the design decisions built on top of them
(sibling application rather than shell conversion; chat components consumed
unrestyled) reopen along with them. A rebrand of this scope is an architecture
decision wearing a naming decision's clothes.

The option is preserved rather than foreclosed, and the asymmetry is the point:
**remaining mergeable keeps the hard fork available later; hard-forking now
destroys the ability to merge.** Revisit when there is evidence — how many
upstream commits over the preceding six months did we actually want? If the
answer approaches zero, the merge cost is already zero and the rename is free.
Against an upstream producing 850 commits a month, that evidence does not exist
today.
