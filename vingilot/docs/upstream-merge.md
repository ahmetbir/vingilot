# Upstream merge ritual

How Vingilot pulls `block/buzz` into its own history. This is the mechanism
ADR-001 decision 6 depends on: staying mergeable only works if merging is
routine, and routine only works if it's cheap. See
[ADR-001](adr/ADR-001-product-composition-and-upstream-boundary.md) for why
this exists, [ADR-004](adr/ADR-004-contribution-policy.md) for the commit/DCO
rules referenced below, and `vingilot/seams.yaml` for the seam inventory.

## Remotes

`origin` is this fork's own GitHub remote (Vingilot, currently empty — nothing
pushed there yet). The real upstream, `block/buzz`, is the **`upstream`**
remote:

```
$ git remote -v
origin    https://github.com/ahmetbir/vingilot.git (fetch/push)
upstream  https://github.com/block/buzz.git (fetch)
```

Everything below diffs and merges **from** `upstream/main`, never
`origin/main` — the latter is the fork's own (currently empty) tip and will
either show "nothing incoming" or simply not have the history yet. The
merge branch is then pushed **to** `origin`, not `upstream`. (ADR-004 was
written before `upstream` existed as a distinct remote; if you're reading
this after that ADR without also reading this correction, trust the
`git remote -v` output over the ADR's prose.)

**Pushing to the wrong remote fails differently depending on direction.**
`git push origin ...` is always safe — it's this fork's own repo, you have
write access, and it's empty so there's nothing to collide with. `git push
upstream ...` is not merely unsafe, it's **impossible**: there is no write
access to `block/buzz`. If a command ever tries to push there, the failure
mode is a confusing auth/permission error, not an accidental change to
upstream — don't spend time worrying you've damaged `block/buzz`; you can't
reach it write-wise at all. If you see that error, the fix is checking which
remote the command targeted, not investigating upstream's state.

## Cadence and triggers

Upstream produces on the order of **850 commits/30 days** (ADR-001). Batches
must stay small, so:

- **Dry-run (`upstream-merge-dryrun.sh`): daily.** It's read-only and cheap
  enough to run on a schedule (cron, or a scheduled CI job once one exists)
  or just at the start of the day. Also run it on demand before starting any
  Workbench task that will alias-import a chat slice — you want to know
  *before* you start whether the ground under that slice moved recently.
- **Actual merge: weekly, minimum.** Pull it forward, out of cadence,
  whenever:
  - the daily dry-run verdict is `risky` — resolve that one narrow batch
    before more upstream commits pile on top of the conflicting file;
  - before cutting a release branch;
  - a security-relevant commit lands upstream (skim incoming commit
    subjects for `fix(auth)`, `CVE`, `security`, `RUSTSEC` — e.g. this repo's
    own history has `chore(deps): bump nostr-relay-pool for RUSTSEC-2026-0224`
    as a real incoming commit; don't let that sit in the batch queue).
- Never let a gap exceed a couple of weeks — the whole point of ADR-001's
  seam inventory and alias-import strategy is that small, frequent merges are
  cheap and big ones aren't. A month of silence turns this from a five-minute
  ritual back into the shell-rewrite problem ADR-001 exists to avoid.

## Command sequence

```bash
. ./bin/activate-hermit                     # repo convention: hooks/just need it on PATH

git fetch upstream main
vingilot/scripts/upstream-merge-dryrun.sh   # read the VERDICT line before doing anything else
```

If the verdict is `clean` or `review-needed` and you've read the flagged
lines (seam hits / conflict candidates) and understand them, proceed:

```bash
git checkout main
git checkout -b vingilot/upstream-merge-$(date +%Y-%m-%d)

git merge --no-ff --signoff upstream/main \
  -m "Merge upstream block/buzz @ $(git rev-parse --short upstream/main)"
# Signed-off-by is required on this commit too — ADR-004 decision 1 makes no
# exception for fork-local commits, and a merge commit is a commit.

# ...resolve any conflicts here (see "Resolving conflicts" below)...
git add <resolved paths>
git commit           # only if the merge stopped for conflicts; lefthook's
                      # commit-msg hook adds Signed-off-by automatically

just ci               # fmt + clippy + desktop lint + unit tests + builds
# If any incoming file falls under a path the Workbench alias-imports,
# also build the Workbench explicitly — see "The blind spot" below.

git push -u origin vingilot/upstream-merge-$(date +%Y-%m-%d)
gh pr create --title "Merge upstream block/buzz @ $(git rev-parse --short upstream/main)" \
  --body "Dry-run verdict: <paste it>. Seam hits: <list or none>. Conflict candidates: <list or none>."
```

This is a **fork-local** commit in ADR-004's taxonomy (it never becomes a
`block/buzz` PR), so it takes the `vingilot/<slug>` branch prefix and the
lighter fork-local commit rules — but DCO sign-off is still mandatory
(ADR-004 decision 1 applies without exception). Route it through a PR rather
than pushing straight to `main`: a seam-inventory entry existing at all is,
per ADR-001, "a decision, not a detail," and a merge that touches one deserves
the same CI gate and review as any other change touching that seam.

## Reading the verdict

`upstream-merge-dryrun.sh` prints one of three verdicts, in ascending order
of how much attention the batch needs:

| Verdict | Meaning | What it does *not* mean |
|---|---|---|
| `clean` | No file both sides touched; upstream touched no declared seam. | It does **not** mean the merge is risk-free — see "The blind spot" below. |
| `review-needed` | Either upstream touched a path in `vingilot/seams.yaml` (no git-level conflict expected, but the fork's seam edit there needs a human look), or `vingilot/seams.yaml` itself is missing so seam risk couldn't be checked at all. | Not necessarily a git conflict — often a clean auto-merge that still needs eyes. |
| `risky` | Upstream and the fork changed the *same file* since the merge-base (including uncommitted fork changes) — a real git conflict is likely. | — |

`risky` outranks `review-needed`: a file can be both a declared seam *and* a
live conflict candidate (the fork's seam edit and upstream's change landed on
the same lines), and the tool reports that as `risky` since the git-level
conflict is the more urgent problem.

Note why seam hits matter even without a git conflict: a seam entry can be
**older than the current merge-base** — it's a permanent, marker-commented
edit that was already merged in some earlier cycle, not something the fork
changed *in this batch*. Diffing "what the fork changed recently" against
"what upstream changed" would miss it entirely. Diffing "what upstream
changed" against "the declared seam inventory" catches it. That's why the
dry-run script checks both, separately.

## Resolving conflicts

**A seam path conflicts** (the conflict is inside a path listed in
`vingilot/seams.yaml`): the fork's edit there carries a `reason` and an
`owner` for a reason. Do not resolve by taking "theirs" (silently drops the
seam, reopens whatever `reason` it was tracking) or "ours" (reverts
upstream's change). Re-apply the fork's marked edit on top of upstream's new
structure, preserving intent, then re-read the `reason` field and confirm it
still describes what the code now does. If the path itself moved, update the
`path` entry in `seams.yaml` to match — `vingilot/scripts/check-seams.sh`
will otherwise flag the new path as an undeclared seam on your very next
commit there.

**Fork-owned code conflicts** (the conflict is inside `vingilot/`, or in a
file that's normally 100% fork-owned): per ADR-001's dependency-direction
rule, upstream never imports from `vingilot/`, so this should be rare — the
one realistic case is a file both sides add entries to additively, e.g.
`pnpm-workspace.yaml` (upstream adds/reorders its own packages; the fork adds
the Workbench). These are usually a straightforward union — keep both sides'
entries — not a logic conflict.

**Anything else** — a path outside both `vingilot/seams.yaml` and
`vingilot/` that still conflicts — means the fork touched an upstream file it
had no declared reason to touch. That's a seam inventory gap: fix it forward
by adding the missing entry to `seams.yaml` once the conflict is resolved, so
`check-seams.sh` and the next dry-run both see it next time.

## The blind spot: alias-imported files never show up as a conflict

`vingilot/seams.yaml`'s inventory is scoped to relay/core/db/SDK/ACP changes
(ADR-001 decision 6) — backend paths the fork edits directly. It says
**nothing** about the Workbench's alias-imported desktop chat slices
(`desktop/src/features/**`, reached via the `@/*` alias per ADR-001's
verified-observations table). The fork doesn't edit those files, so there's
no seam entry and, when upstream changes one, no git conflict either — the
merge goes through clean. But "clean" here can still mean the Workbench fails
to *build*, because ADR-001 says it plainly: **"Compiling is not the same as
mounting."** Upstream renaming an export, changing a component's props, or
reshuffling a barrel `index.ts` breaks the Workbench at compile time with
zero signal from git or from the seam check.

This is not hypothetical. The first real batch this tool ever inspected
(`upstream/main` vs. this fork's `HEAD` at merge-base `19d57b0d4`, 11 commits)
already contains exactly this case:

```
desktop/src/features/channels/ui/ChannelPane.tsx
desktop/src/features/messages/ui/MessageRow.tsx
desktop/src/features/messages/ui/MessageThreadPanel.tsx
desktop/src/features/messages/ui/MessageTimeline.tsx
desktop/src/features/messages/ui/TimelineMessageList.tsx
```

— all under `desktop/src/features/messages` and `.../channels`, the exact
slices the Phase 0 spike mounts (message list + composer). None of these are
in `seams.yaml`. The dry-run's verdict for that batch was `clean`. It was
correctly clean by its own definition (no shared-file conflict, no declared
seam touched) and it is still a batch you must not merge without a Workbench
build.

**Rule:** whenever the dry-run's "Incoming files" list contains anything
under a path the Workbench alias-imports (`desktop/src/features/**` today —
narrow this once Phase 0 lands and the actual mounted slice set is known),
treat the batch as needing a Workbench build regardless of what the verdict
line says, and make that build part of "verify before pushing" below. If the
Workbench doesn't compile against the new slice and the fix isn't a small,
mechanical update, that's the Phase 0 fallback territory (ADR-001,
"Alternatives" / exit criteria): stop trying to track upstream's internal
refactor and fall back to the fork-owned adapter.

## Verify before pushing

1. `git status` clean, no leftover conflict markers:
   `git grep -n -E '^(<<<<<<< |=======$|>>>>>>> )' -- ':!*.md'` should print
   nothing. (`git grep` skips `node_modules`; the tighter pattern — requiring
   the ref-name/space that real conflict markers carry — avoids false hits
   from unrelated `===`-style dividers, e.g. in `docs/spec/*.tla`. The `.md`
   exclusion avoids a false hit from this very doc.)
2. `just ci` — fmt, clippy, desktop lint, unit tests, builds.
3. If the batch touches `crates/buzz-relay`, `buzz-db`, or `buzz-auth`, also
   run `just test` (needs Postgres + Redis).
4. If the batch touches any Workbench alias-import path (see above), build
   the Workbench explicitly. There is no existing gate for this — `just ci`
   predates the Workbench — so until one is wired in, this step is manual and
   easy to forget. Don't skip it because `just ci` was green.
5. For every conflict you resolved on a seam path, re-read that seam's
   `reason` in `seams.yaml` against the resolved code and confirm it's still
   true, not just that it compiles.
6. Push the branch, open the PR, wait for CI green and review before merging
   — don't push a resolved merge straight to `main`.

## When to abort instead of forcing a resolution

`git merge --abort` (if not yet pushed) or revert the merge commit with a new
commit (if it already landed) — never force a resolution — when:

- Resolving a seam conflict requires more than re-applying the fork's marked
  block onto upstream's new structure (upstream substantially rewrote the
  surrounding code). Abort, note the specific seam + upstream commit, and
  retry after the next dry-run once upstream's refactor series has settled —
  a smaller, later batch is often a strictly easier merge than the same
  conflict caught mid-refactor.
- The conflicting seam sits in trust/auth-sensitive territory (ADR-003).
  Don't resolve these solo under time pressure; get a second reviewer before
  reattempting.
- The Workbench fails to build after a clean merge (the blind-spot case
  above) and the fix isn't small and mechanical. Fall back per ADR-001's
  Phase 0 fallback rather than chasing the refactor.
- You find yourself deleting or hollowing out a fork's seam marker/`reason`
  just to make something compile. That silently reopens exactly the gap the
  seam inventory exists to track — abort and fix it properly instead, even if
  that means missing this cadence and retrying next time.

## See also

- `vingilot/scripts/upstream-merge-dryrun.sh --help` — the tool this runbook
  wraps.
- `vingilot/scripts/check-seams.sh` — the complementary, opposite-direction
  check: it gates the fork's *outgoing* diff against the same
  `vingilot/seams.yaml`, in CI, on every branch. This runbook's dry-run script
  checks upstream's *incoming* diff against the same file. Same inventory,
  both directions.
- [ADR-001](adr/ADR-001-product-composition-and-upstream-boundary.md) — why
  this ritual exists at all.
- [ADR-004](adr/ADR-004-contribution-policy.md) — commit/branch/DCO rules
  this ritual's commits follow.
