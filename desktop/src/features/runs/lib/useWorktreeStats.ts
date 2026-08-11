// Keeping the worktree rows' `+`/`−` current without freezing anything
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 3).
//
// **Three decisions, all of them about cost.**
//
// 1. **One call for the whole project, on an interval of its own.** The
//    backend reads the worktrees sequentially on one blocking thread
//    (vingilot_worktree/stat.rs), so this hook has nothing to gain from N
//    round trips — and the workspace's own 2s coordinator poll is the wrong
//    clock for a read that spawns git subprocesses. `REFRESH_MS` is slower on
//    purpose: `+12 −3` a few seconds stale is still the right answer, and a
//    terminal that stutters is not.
//
// 2. **The answer is cached, and a refresh never blanks it.** A worktree keeps
//    its last known numbers until a newer answer arrives for that same path,
//    so a slow or partial read shows stale counts rather than zeros — zeros
//    being a claim ("nothing has changed here") this app is not entitled to
//    make on the strength of a read that did not finish. The cache is rebuilt
//    from the current targets on every answer, so a worktree that leaves the
//    project takes its entry with it and this cannot grow.
//
// 3. **One read in flight at a time.** A read slower than the interval would
//    otherwise queue behind itself and turn a busy repository into a growing
//    pile of git processes.
//
// The effect is keyed on a *string* built from the targets, for the same
// reason `useWorktreeActions` is: the arrays here are rebuilt by a polling
// loop every couple of seconds, and an effect that depended on them would
// re-read git forever.

import * as React from "react";

import { gitWorktreeStats } from "@/features/runs/lib/worktreeClient";
import { projectsKey, readProjectsKey } from "@/features/runs/lib/worktreeGit";
import type { WorktreeStat } from "@/features/runs/lib/worktreeStat";

/** Slower than the workspace poll (2s) deliberately — see this module's
 * header. A create, a remove, or a project switch changes the target set and
 * re-reads immediately, so this interval only governs the case where nothing
 * the app knows about has changed. */
const REFRESH_MS = 5_000;

/** A worktree to read: the id its stat is filed under, and the directory git
 * is asked in. */
export interface WorktreeTarget {
  id: string;
  path: string;
}

/** Stats by binding id. A worktree with no entry is one nothing is known
 * about — never one that is clean. */
export type WorktreeStats = Readonly<Record<string, WorktreeStat>>;

export function useWorktreeStats(
  targets: readonly WorktreeTarget[],
): WorktreeStats {
  const key = projectsKey(targets);
  const [stats, setStats] = React.useState<Record<string, WorktreeStat>>({});
  const reading = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    const wanted = readProjectsKey(key);

    async function read() {
      if (reading.current) return;
      if (wanted.length === 0) {
        setStats((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }
      reading.current = true;
      const answer = await gitWorktreeStats(wanted.map((t) => t.path));
      reading.current = false;
      if (cancelled) return;
      // A refusal is not an answer about any worktree — the previous numbers
      // stand until git says otherwise.
      if (!answer.ok) return;

      const byPath = new Map(answer.value.map((stat) => [stat.path, stat]));
      setStats((prev) => {
        const next: Record<string, WorktreeStat> = {};
        for (const target of wanted) {
          const kept = byPath.get(target.path) ?? prev[target.id];
          if (kept !== undefined) next[target.id] = kept;
        }
        return next;
      });
    }

    void read();
    const handle = setInterval(() => void read(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [key]);

  return stats;
}
