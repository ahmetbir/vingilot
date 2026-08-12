// The reads behind ⌘P's list. Every decision here is `worktreeFiles.ts`'s —
// this file is the effect that runs them (vingilot/docs/plans/
// 2026-08-12-an-ide-of-a-kind.md, Task 2).
//
// **`active` is "there is a checkout to read", not "the door is open."** The
// only caller passes `worktreeCwd !== null` (`useWorkspacePalette.ts`), so the
// root of a selected worktree is listed whether or not ⌘P is ever pressed —
// one `worktree_tree` call per worktree selection, the same call the Files pane
// makes when it is opened. The argument for paying it eagerly is
// `useWorkspacePalette.ts`'s header ("Why the file listing is read as soon as a
// worktree is selected"): the door's own state lives inside `usePalette`, which
// is built *from* this hook's answer, so a listing that waited for the door
// would arrive a render after the chord and show an empty box for a frame.
//
// What is still lazy is everything below the root: the deepening is driven by
// the query, so a worktree nobody has searched costs one listing and no walk.
// The listings are dropped when the worktree changes, because a path list is
// meaningless without the checkout it came from.
//
// **One pass per render, guarded.** The deepening effect asks
// `worktreeFiles.ts` what to read next and stops when it answers with nothing —
// which it does on an empty query, at the cap, and when the frontier is empty.
// That is what keeps this from being a loop: the answer shrinks every pass
// because every pass adds keys to the map it is asked about.

import * as React from "react";

import { readTree } from "@/features/runs/lib/filesClient";
import type { TreeEntry } from "@/features/runs/lib/filesModel";
import type { PaletteFile } from "@/features/runs/lib/paletteSources";
import {
  knownFiles,
  type Listed,
  nextDirs,
} from "@/features/runs/lib/worktreeFiles";

const NO_FILES: readonly PaletteFile[] = [];

/**
 * @param worktree the checkout's own directory, or `null` when there is none.
 * @param active whether this worktree is worth reading at all — nothing is read
 * while false. The caller decides what that means; today it is "a checkout is
 * selected" (see this file's header).
 * @param query what he has typed, which is what decides how deep to go.
 */
export function useWorktreeFiles(
  worktree: string | null,
  active: boolean,
  query: string,
): readonly PaletteFile[] {
  const [listed, setListed] = React.useState<Listed>(new Map());
  // Which worktree the map above is a listing OF. Held beside it rather than in
  // a dependency array so a stale answer for the previous checkout can be
  // dropped on arrival: a read started before a worktree switch lands after it.
  const [listedFor, setListedFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (worktree === listedFor) return;
    setListed(new Map());
    setListedFor(worktree);
  }, [listedFor, worktree]);

  React.useEffect(() => {
    if (!active || worktree === null || worktree !== listedFor) return;
    const wanted = listed.has("") ? nextDirs(listed, query) : [""];
    if (wanted.length === 0) return;
    let dropped = false;
    void (async () => {
      const answers = await Promise.all(
        wanted.map(async (dir) => ({
          dir,
          read: await readTree(worktree, dir),
        })),
      );
      if (dropped) return;
      setListed((prev) => {
        const next = new Map(prev);
        for (const answer of answers) {
          // A refusal is recorded as an empty listing rather than left out: an
          // unrecorded directory is one the frontier offers again on every
          // pass, which is the loop this whole module is shaped to avoid. What
          // it is NOT is a claim that the directory is empty — nothing reads
          // this map for that, and `FilesPane` is where a refusal is a
          // sentence.
          next.set(
            answer.dir,
            answer.read.ok
              ? (answer.read.value.entries as readonly TreeEntry[])
              : [],
          );
        }
        return next;
      });
    })();
    return () => {
      dropped = true;
    };
  }, [active, listed, listedFor, query, worktree]);

  return React.useMemo(() => {
    if (worktree === null || worktree !== listedFor) return NO_FILES;
    return knownFiles(listed).map((path) => ({
      // A row from the tree carries no line: he has not been in this file yet,
      // and inventing line 1 would put a highlight on a row he did not ask
      // about (`filesTarget.ts`'s rule).
      line: null,
      path,
      worktree,
    }));
  }, [listed, listedFor, worktree]);
}
