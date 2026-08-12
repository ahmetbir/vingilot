// Two worktrees, one file, before either of them merges
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md — the same
// "borrow the logic, not the chrome" rule the attention dots were built under).
//
// **The gap this fills.** A merge conflict is discovered at merge time by every
// tool that exists. But the workspace already holds both halves of the answer
// hours earlier: git has been asked, every 5 s, what each worktree changed
// (`useWorktreeStats.ts`), and the answer names the files. Two worktrees that
// have both touched `src/app/App.tsx` are going to collide, and nothing on the
// screen says so until one of them is merged. This module is that sentence,
// derived from data already on the wire.
//
// **It is NOT a fifth attention state, and the distinction is the whole
// design.** `attentionSignal.ts`'s four states answer *"where is my attention
// needed?"* — they are a claim about work that is waiting on the owner, they
// have a written precedence, and they roll up into a project dot and the
// board's headline. An overlap is none of that. It is not a task, nothing is
// blocked by it, no run is waiting, and it may be entirely intentional (two
// worktrees off the same feature branch, a lockfile both regenerate). Folding
// it into that taxonomy would mean answering three questions wrongly at once:
// where does it sit in a precedence built from "what changes next if nothing is
// done" (nothing changes — it is a standing fact about two trees); what does
// the project rollup say about it (a rollup is over one worktree's states, and
// an overlap is a property of a *pair*, which has no place in a per-row rank);
// and what does the triage board do with it (put it in a list of things needing
// him, which is exactly the wrong claim). So this is derived separately, drawn
// separately (`ui/OverlapMark.tsx`, a glyph rather than one of the four
// shapes), and reaches neither `rollupMark` nor `triageModel`. Informational,
// not "needs you".
//
// **Two real answers, or nothing.** A worktree whose stat has not landed, or
// whose path git could not read, has `paths: null` — and a `null` is not an
// empty set. Reading it as one would make it silently agree with every other
// worktree that they share no files, which is a claim nothing made. So a `null`
// contributes nothing and, just as importantly, *receives* nothing: it can
// neither raise a mark nor be named in one. The mark is only ever drawn from
// two worktrees that both answered.
//
// **Truncation under-reports, and never over-reports.** Past the backend's
// per-worktree path cap a list is a subset (`WorktreeStat.pathsTruncated`).
// Every sentence here is existential — "these 3 files also changed in X" — and
// an existential claim off a subset is still true; what a subset cannot support
// is "these are all of them", which is why no sentence here says that and why
// a cut list is worded "at least".
//
// Pure: no React, no Tauri, no client. `useWorktreeSignals.ts` assembles the
// inputs from stats it already has; `ui/OverlapMark.tsx` draws exactly what
// comes out of here.

/** One worktree, as this comparison needs it. Deliberately not a `Worktree`:
 * the derivation cares about an identity, a name to say out loud, and a set of
 * files, and taking the whole record would let a later change reach for
 * `owner_run_status` and quietly turn this into a second attention signal. */
export interface OverlapInput {
  bindingId: string;
  /** What the row calls it — `worktreeSummary(wt).label`, the branch name. It
   * is carried in rather than looked up because the sentence names the *other*
   * worktree, and a renderer holding one row cannot name a row it does not
   * have. */
  label: string;
  /** The files git says changed here, or `null` when nothing has answered.
   * `[]` is an answer ("this worktree changed nothing"); `null` is not. */
  paths: readonly string[] | null;
  /** git named more files than `paths` carries, so an intersection with this
   * worktree may under-report. */
  truncated: boolean;
}

/** The other worktree in one overlapping pair, and what the two share. */
export interface OverlapPeer {
  bindingId: string;
  label: string;
  /** Sorted, so two rows describing the same pair list it identically. */
  files: string[];
}

/** What one worktree's mark says. Produced only for worktrees with at least
 * one peer — a worktree that overlaps nothing has no entry, rather than an
 * entry with an empty `peers`, so a renderer cannot draw an empty mark by
 * forgetting to check. */
export interface WorktreeOverlap {
  /** Every file this worktree shares with any other, sorted and distinct.
   * Not `peers.flatMap(...)`: one file shared with two other worktrees is one
   * file, and the row says "2 files" about the tree and not about the pairs. */
  files: string[];
  /** Ordered by label, so the sentence is stable across polls. */
  peers: OverlapPeer[];
  /** The row's words: "3 files also changed in spike-1". */
  sentence: string;
  /** The mark's own title — the sentence plus the files themselves, which is
   * the question "which ones?" that the sentence provokes. */
  detail: string;
}

/** Files named in `detail` per peer before it stops naming them. A title is
 * read in a tooltip; forty paths in one is not read at all. The count is still
 * exact in the sentence, so nothing is hidden — only unlisted. */
const MAX_NAMED = 8;

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

/** "3 files also changed in spike-1" — or "at least 3" when either side's
 * list was cut, because the number is then a floor and not a total. */
function peerSentence(peer: OverlapPeer, partial: boolean): string {
  const count = `${peer.files.length} file${plural(peer.files.length)}`;
  return `${partial ? "at least " : ""}${count} also changed in ${peer.label}`;
}

function namedFiles(files: readonly string[]): string {
  return files.length <= MAX_NAMED
    ? files.join(", ")
    : `${files.slice(0, MAX_NAMED).join(", ")}, and ${files.length - MAX_NAMED} more`;
}

/** Which worktrees changed each file. Only worktrees that answered are in
 * here at all, which is what keeps a silent one out of every pair below. */
function ownersByPath(
  worktrees: readonly OverlapInput[],
): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const wt of worktrees) {
    if (wt.paths === null) continue;
    // Distinct per worktree: a path listed twice by one tree is still one
    // file, and would otherwise be counted twice in every pair it joins.
    for (const path of new Set(wt.paths)) {
      const seen = owners.get(path);
      if (seen === undefined) owners.set(path, [wt.bindingId]);
      else seen.push(wt.bindingId);
    }
  }
  return owners;
}

/** Every worktree that shares a changed file with another worktree of the same
 * project, and what they share.
 *
 * Callers pass **one repository's** worktrees. Two projects with a `README.md`
 * each are not in conflict, and comparing across them would put a mark on
 * nearly every row in the workspace — the surface-destroying false positive
 * this whole island's dot discipline exists to avoid.
 *
 * Built through an inverted index (file → worktrees) rather than by comparing
 * every pair of sets: the pairs that matter are only those a shared file
 * actually creates, so the work is proportional to the changed files and to the
 * overlaps that exist, not to the square of the worktree count. */
export function worktreeOverlaps(
  worktrees: readonly OverlapInput[],
): ReadonlyMap<string, WorktreeOverlap> {
  const byId = new Map(worktrees.map((wt) => [wt.bindingId, wt]));
  // bindingId → (peer bindingId → shared files)
  const shared = new Map<string, Map<string, string[]>>();

  for (const [path, owners] of ownersByPath(worktrees)) {
    if (owners.length < 2) continue;
    for (const owner of owners) {
      const peers = shared.get(owner) ?? new Map<string, string[]>();
      shared.set(owner, peers);
      for (const other of owners) {
        if (other === owner) continue;
        const files = peers.get(other);
        if (files === undefined) peers.set(other, [path]);
        else files.push(path);
      }
    }
  }

  const overlaps = new Map<string, WorktreeOverlap>();
  for (const [bindingId, peerFiles] of shared) {
    const self = byId.get(bindingId);
    if (self === undefined) continue;

    const peers: OverlapPeer[] = [];
    let partial = self.truncated;
    for (const [otherId, files] of peerFiles) {
      const other = byId.get(otherId);
      if (other === undefined) continue;
      if (other.truncated) partial = true;
      peers.push({
        bindingId: otherId,
        files: [...files].sort(),
        label: other.label,
      });
    }
    if (peers.length === 0) continue;
    // By label, then by id: two worktrees may carry the same label (a checkout
    // with no branch), and a sentence whose clauses reorder between polls is a
    // sentence that looks like it changed when nothing did.
    peers.sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        a.bindingId.localeCompare(b.bindingId),
    );

    const files = [...new Set(peers.flatMap((peer) => peer.files))].sort();
    overlaps.set(bindingId, {
      detail: peers
        .map(
          (peer) => `${peerSentence(peer, partial)}: ${namedFiles(peer.files)}`,
        )
        .join("; "),
      files,
      peers,
      sentence: peers.map((peer) => peerSentence(peer, partial)).join("; "),
    });
  }
  return overlaps;
}
