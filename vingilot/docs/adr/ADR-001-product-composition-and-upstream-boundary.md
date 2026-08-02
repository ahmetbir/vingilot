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

1. **One physical monorepo; the layer boundary is logical.** The fork is not split
   into multiple repositories.

2. **Upstream Buzz desktop is preserved as an upstream-owned chat client.** Its
   chrome is not converted into the Workbench. It continues to build and ship as
   upstream ships it.

3. **The Workbench is a new sibling application** in the same monorepo, added to
   `pnpm-workspace.yaml`. It is a new Tauri app with its own entry point.

4. **Coordinator and executors are new services/modules**, not modifications of
   existing crates.

5. **All fork-owned code and documentation live under a single root: `vingilot/`.**

6. **Upstream touches are confined to a declared seam inventory.** Relay, core,
   db, SDK, and ACP changes are permitted only at paths listed in
   `vingilot/seams.yaml`, each with a marker comment and a reason. CI fails on any
   diff outside `vingilot/` that is not in the inventory. This converts K2 from an
   intention into a machine-checked rule.

7. **Chat reuse mechanism: alias import is the default; extraction is forbidden.**
   The Workbench imports upstream slices in place. Moving upstream files into new
   packages is explicitly rejected — it creates the largest possible merge surface,
   which is the outcome K1 exists to avoid. When upstream refactors a slice, the
   breakage appears at build time in our app, which is orders of magnitude cheaper
   to resolve than a shell-level merge conflict.

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
