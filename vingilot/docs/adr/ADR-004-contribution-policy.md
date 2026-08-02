# ADR-004 — Contribution policy: fork-local vs. upstream-bound work

- **Status:** Accepted
- **Date:** 2026-08-02
- **Related:** ADR-001 (product composition and the upstream boundary — the
  `vingilot/` root, the seam inventory)

## Context

This repo is a fork of `block/buzz` in the ADR-001 sense — a standalone private
repository rather than a GitHub fork, since a fork of a public repository cannot
be made private. The remotes reflect that and every command below depends on it:

    origin    ahmetbir/vingilot   the fork's own repository — push here
    upstream  block/buzz          the source — merge from here, never push

It inherited `CONTRIBUTING.md`, `AGENTS.md` (symlinked from `CLAUDE.md`), and
`lefthook.yml` unchanged from upstream. All three were written for one
direction of travel only: a contributor working *toward* `block/buzz`. Neither
document has a clause for a commit that will never leave this fork — because
until ADR-001, that case didn't exist. Both state the sign-off rule as
unconditional:

> Every commit needs a Developer Certificate of Origin (DCO) sign-off. The
> `-s` flag appends a `Signed-off-by` trailer that certifies you wrote the
> change and can contribute it under the project license. The **DCO Check**
> will block your PR without it.
> — `CONTRIBUTING.md:52`

> **Commit with `git commit -s`.** The required **DCO Check** fails any PR
> with a commit missing a `Signed-off-by` trailer...
> — `AGENTS.md:111`

These two do not contradict each other — I checked both for daylight on
sign-off, trailer order, rebase/cherry-pick caveats, and GPG, and found none;
where they overlap they say the same thing in the same terms. The gap is not
disagreement, it's silence: neither has ever had to say what applies once a
commit's destination is a fork that also sends patches back.

Evidence gathered to resolve that gap:

| Question | Evidence |
|---|---|
| Does CI implement the "DCO Check" itself? | No. `grep -rn -i "dco\|signoff\|sign-off\|developer certificate\|certificate of origin" .github/workflows/*.yml` returns zero matches across all 14 workflow files. `CONTRIBUTING.md`/`AGENTS.md` both refer to "the DCO Check" as an established gate, but it is not implemented in any versioned file in this repo — it is a required GitHub status check (almost certainly a GitHub App bound in `block/buzz`'s branch protection), external to the repo's own config. |
| Does the `commit-msg` hook restrict by path? | No. `lefthook.yml`'s `commit-msg` block has no `glob:` key, and the file's own header comment says why: "`commit-msg` has no glob: it rewrites the commit message, not files." It runs `git interpret-trailers --if-exists doNothing --trailer "Signed-off-by: ..."` unconditionally for `git commit`/`git merge`; `git rebase`/`git cherry-pick` need their own `--signoff`/`-s` flag. |
| What trailer order does upstream actually use? | Measured over the most recent 400 commits on `upstream/main`: 245 carry both trailer types. Of those, 241 (~98.4%) put **all** `Signed-off-by` lines before **all** `Co-authored-by` lines (e.g. `89bf03c05`, `eb049ddf8`, `756dd7f65`); 4 (~1.6%) do the reverse. No doc anywhere states an order — it is a strong convention, not an enforced rule, and this ADR is the first thing to write it down. Re-run: `git log upstream/main -400 --format='%H' \| while read h; do msg=$(git log -1 --format='%B' "$h"); so=$(grep -ac '^Signed-off-by:' <<<"$msg"); co=$(grep -ac '^Co-authored-by:' <<<"$msg"); [ "$so" -gt 0 ] && [ "$co" -gt 0 ] && grep -aE '^(Signed-off-by\|Co-authored-by):' <<<"$msg" \| head -1 \| cut -d: -f1; done \| sort \| uniq -c` |
| Does any doc require GPG/cryptographic commit signing? | No. `CONTRIBUTING.md`, `AGENTS.md`, `SECURITY.md`, `RELEASING.md`, `GOVERNANCE.md` contain no such requirement. The only `gpg` hit anywhere in the tree outside `crates/git-sign-nostr` is `.github/workflows/release.yml`'s GitHub CLI apt keyring — unrelated to commits. |
| Is there existing commit-signing infra? | Yes, optional: `crates/git-sign-nostr` signs commits/tags with a Nostr secp256k1 key via git's generic `gpg.format x509` / `gpg.x509.program` plumbing (`crates/git-sign-nostr/README.md`). It produces a cryptographic signature `git verify-commit` can check; it is a different thing from the plain-text DCO `Signed-off-by` trailer and nothing wires the two together. |

ADR-001 already drew the boundary this ADR has to sit inside: "All fork-owned
code and documentation live under a single root: `vingilot/`" (§5), and
upstream-touching diffs are permitted only at paths listed in a seam
inventory, `vingilot/seams.yaml` (§6) — not yet created.

## Decision

### 1. `Signed-off-by` is required on every commit, regardless of destination

All commits in this repo carry a `Signed-off-by` trailer — no exception for
work that will stay under `vingilot/` forever. This is a tooling decision, not
a claim that DCO's legal force reaches fork-local code: DCO only binds at the
moment a change is actually offered to `block/buzz`, and a commit that never
leaves this fork carries no such offer. But `lefthook.yml`'s `commit-msg` hook
is glob-free by construction — it "rewrites the commit message, not files,"
so it has no file-level signal to split on, and a commit's eventual
destination (fork-local vs. upstream-bound) usually isn't decided until PR
time, well after the commit exists. Splitting hook behavior by destination
would require tooling that doesn't exist today (see §4's note on what would
have to be built) for a trailer that costs nothing to carry and is never
wrong to have. Keep the hook exactly as installed; treat "every commit is
signed off" as the uniform rule.

### 2. Trailer order

State once: **all `Signed-off-by` trailers, then all `Co-authored-by`
trailers.** Within the `Signed-off-by` block: the primary human
author/committer first, then any other human co-signer, then any AI/agent
identity (Nostr pubkey or model name) last. The `Co-authored-by` block
mirrors the same identities in the same relative order. This is not written
in any upstream doc — it is what `git log upstream/main` actually does in the
large majority of commits, e.g.:

```
Signed-off-by: amanning3390 <adam.manning@pro-serveinc.com>
Signed-off-by: Tyler <109685178+tlongwell-block@users.noreply.github.com>
Signed-off-by: npub1qyvc0c5kl4gqv2fd97fsk46tu378sqgy35vc83rvgfwne90sel7s0ed67d <...>
Co-authored-by: npub1qyvc0c5kl4gqv2fd97fsk46tu378sqgy35vc83rvgfwne90sel7s0ed67d <...>
Co-authored-by: Tyler <109685178+tlongwell-block@users.noreply.github.com>
```

No blank line is required between the two blocks — upstream's own history is
inconsistent on that point (some commits separate them with a `---------`
PR-body divider, most don't), and `git interpret-trailers` (what the hook
uses) doesn't care either way. This repo follows the same rule.

**This is a convention, not an enforced rule.** Measured over the most recent
400 `upstream/main` commits (see the Context evidence table for the exact
command), 241 of 245 commits carrying both trailer types (~98.4%) follow it;
4 (~1.6%) put `Co-authored-by` first. Nothing in CI or in any hook checks
trailer order — `lefthook.yml`'s `commit-msg` command only appends a missing
`Signed-off-by` trailer (`git interpret-trailers --if-exists doNothing`), it
never reorders existing trailers. A commit in this repo that happens to put
`Co-authored-by` first will not fail the DCO Check, `just ci`, or any other
gate — it will just not match the convention this ADR records. Follow it for
consistency; don't treat a mis-ordered trailer as a build break.

### 3. Branch and commit rules differ by destination

**Fork-local (stays in `vingilot/` forever):**
- Branch name prefix `vingilot/<slug>`, matching ADR-001's `vingilot/` root,
  so the destination is visible from the branch name alone.
- Conventional Commits type prefix is still required — house style, kept for
  history hygiene — but it is not CI-enforced the way it is upstream, because
  there is no squash-merge step turning a PR title into the commit subject
  (`vingilot` has no remote or CI of its own yet).
- A branch may freely mix `vingilot/`-only concerns; the "one PR / one
  purpose" and "no `vingilot/` paths in the diff" rules below do not apply.

**Upstream-bound (destined for a `block/buzz` PR):**
- Follow `CONTRIBUTING.md` exactly, unmodified: Conventional Commit type
  prefix (real constraint here — it becomes the squash-merge commit subject),
  DCO sign-off (enforced by the external DCO Check, which only ever fires on
  a PR opened against `block/buzz` — see §5's caveat that this check does not
  exist for `vingilot`'s own eventual repo unless someone configures it
  there), one logical change per PR.
- The diff must not touch `vingilot/` at all, and outside `vingilot/` it must
  stay inside the ADR-001 §6 seam inventory (or be genuinely upstream-generic)
  — upstream must never see a path that only makes sense in this fork's
  context.
- Built from a branch cut off current `upstream/main`, not off the fork's own
  integration branch, so the PR's diff doesn't carry fork-only history along
  with it. This is exactly the existing `CONTRIBUTING.md` "External
  contributors: Fork `block/buzz`, open a PR" flow — `vingilot`'s own GitHub
  repo (once created) is, for this purpose, just another fork of `block/buzz`.

### 4. Repairing a fork-local commit that turns out to be upstream-worthy

The path is **cherry-pick onto a fresh branch off current `upstream/main`**,
never an in-place rebase of the fork's own trunk — rebasing `vingilot`'s
shared integration branch to satisfy one upstream PR would rewrite history
other fork work depends on. None of the following is repaired automatically
by any existing hook or CI job; each is a manual check:

1. `git checkout -b <upstream-branch> upstream/main`
2. `git cherry-pick <fork-commit>` — or, if the original diff spans both
   `vingilot/` and seam paths, split it (`git checkout -p` / `git add -p`)
   and drop the `vingilot/`-only hunks; only seam-inventory or genuinely
   generic paths may travel upstream.
3. **Re-verify the `Signed-off-by` identity is correct for an upstream
   submission.** The mechanical stamp from `lefthook.yml`'s `commit-msg` hook
   used the local committer identity at commit time, which may not be the
   right legal signer for a contribution now going to `block/buzz` (for
   example, a fork-local commit authored purely under an agent/Nostr
   identity with no accompanying human sign-off). If it isn't, `git commit
   --amend -s` with the correct human identity before opening the PR — DCO
   sign-off is not something a hook can retroactively validate, only add.
4. Rewrite the commit message into Conventional Commits form if the
   fork-local commit didn't already use it — it becomes the literal PR title
   and, on squash-merge, the commit subject in `block/buzz`'s `main`.
5. Run `just ci` on the cherry-picked branch itself, not on `vingilot`'s
   integration branch — fork-only lint/build config must not leak into what
   upstream CI evaluates.
6. Open the PR per `CONTRIBUTING.md`. The original commit is left untouched
   in `vingilot`'s own history; there is no requirement to reconcile the two
   copies.

If this repair happens often enough to be worth automating, what would need
to be built is a `just upstream-cherry-pick <sha>` recipe covering steps 1, 2,
and 5 mechanically — it does not exist today. Step 3 cannot be automated at
all: identity correctness for a legal certification is a human judgment call,
not a lint rule.

### 5. GPG / commit signing is not required

No contradiction was found between the repo's docs on this point — the
honest finding is silence, not disagreement: `CONTRIBUTING.md`, `AGENTS.md`,
`SECURITY.md`, `RELEASING.md`, and `GOVERNANCE.md` mandate no cryptographic
commit signature, for either fork-local or upstream-bound work. Decision:
leave it that way — do not add a GPG requirement, since no branch protection
or CI on either side would check it, and no distribution mechanism for
verification keys exists.

Keep two things distinct, since they're easy to conflate under "signing":

- **DCO `Signed-off-by`** — plain-text trailer, mandatory per §1, checked by
  the external DCO status check on `block/buzz` PRs.
- **`git-sign-nostr` (`crates/git-sign-nostr`)** — optional cryptographic
  commit/tag signature using a Nostr secp256k1 key, wired through git's
  generic `gpg.format`/`gpg.x509.program` interface (hence the `gpg` naming),
  documented in its own README and `docs/nips/NIP-GS.md`. Nothing in this
  repo requires enabling it, and enabling it satisfies no DCO obligation —
  the two mechanisms are orthogonal.

## Consequences

- Every commit, on every branch, gets a `Signed-off-by` trailer via the
  existing unmodified hook — no new tooling to write or maintain for §1.
- Contributors must consciously name fork-local branches `vingilot/<slug>` and
  keep upstream-bound branches clean of `vingilot/` paths; nothing currently
  enforces either at commit time — both are reviewer/self-discipline until a
  CI check is written (the seam-inventory CI rule from ADR-001 §6 covers the
  path-scope half once it exists; branch naming is not enforced anywhere).
- Moving a fork-local commit upstream is a manual, six-step checklist (§4)
  with one step (sign-off identity) that will likely never be automatable.
- No GPG infrastructure to stand up, distribute keys for, or maintain.

## Alternatives considered and rejected

**A. Glob-restrict the `commit-msg` hook so `vingilot/`-only commits skip
sign-off.** Rejected. `lefthook.yml` states plainly that `commit-msg` has no
file-level signal to restrict on ("it rewrites the commit message, not
files"); building that signal (e.g. inspecting branch name or staged paths
inside the hook) is real complexity purchased for skipping a trailer that
costs nothing to add, and it would make §4's cherry-pick path strictly worse,
not better.

**B. Require GPG (or `git-sign-nostr`) signing repo-wide.** Rejected on
absence of enforcement: no branch protection, on either `block/buzz` or a
future `vingilot` repo, checks for it, and no key-distribution mechanism
exists. A policy with no enforcement path is friction without a gate.

**C. Repair upstream-worthy commits by rebasing them in place on `vingilot`'s
own trunk, then pushing that rebased history as the PR.** Rejected — this
rewrites shared fork history that other in-progress fork work may already
depend on, for the benefit of a single outbound PR. Cherry-pick onto a fresh,
disposable branch achieves the same result without touching `vingilot`'s
trunk.
