// The escape hatch's two directions, wired to the workspace
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1; ADR-005 rung 3).
//
// **Out** — the ⌘K row that opens the file the viewer has in the owner's
// editor. The buttons on the four surfaces do not come through here: each of
// them knows its own file and calls `editorClient` directly (`OpenInEditor`).
// This is the door for the one caller that has no row of its own to act on, so
// it is also the only one that has to *find* the open file.
//
// **In** — the `vingilot` shell command, and the one act it needs a decision
// for: installing itself outside this app's directories.
//
// **One sentence surface for both.** Neither of these has a row to speak on:
// the palette closes on Enter, and a terminal command's window is gone by the
// time the app answers. So a single dismissible notice is held here and drawn
// by the screen. It is a state and not a toast — a sentence about what did not
// happen should not time out while he is reading it.
//
// Split out of `RunsScreen.tsx` for the 1000-line ratchet, along with
// `usePaletteCommands.ts`: the screen keeps the state these callbacks act on
// and this file keeps the two gestures.

import * as React from "react";

import {
  installShimLink,
  openInEditor,
  readShimStatus,
} from "@/features/runs/lib/editorClient";
import type { KnownPlace } from "@/features/runs/lib/openTarget";
import type { ShimLinkage } from "@/features/runs/lib/paletteSources";
import {
  type Repo,
  type Worktree,
  worktreeCwd,
} from "@/features/runs/lib/projects";
import { useEditorAction } from "@/features/runs/lib/useEditors";
import { useVingilotOpen } from "@/features/runs/lib/useVingilotOpen";

/** What the viewer reported it has open — `placeMru.ts`'s `FileReport`, read
 * for its two fields only. `path` of `null` is the pane saying it has nothing
 * open, which is a different thing from no report at all. */
export interface OpenFileReport {
  path: string | null;
  worktree: string;
}

export interface EscapeHatch {
  /** The sentence about the last thing that did not work, or `null`. */
  notice: string | null;
  dismissNotice: () => void;
  /** The ⌘K row's action. */
  openCurrentFileInEditor: () => void;
  /** The ⌘K row's action for the shell command. */
  installShim: () => void;
  /** What the disk says about that command, for the row's own label, or `null`
   * until the first read answers. */
  shim: ShimLinkage | null;
}

interface Options {
  addProject: () => void;
  openedFile: OpenFileReport | null;
  repoWorktrees: readonly Worktree[];
  repos: readonly Repo[];
  selectRepo: (repoId: string) => void;
  selectWorktree: (bindingId: string) => void;
  selectedRepo: Repo | null;
  showFiles: () => void;
  /** Where the executor checks worktrees out, or `null` before the home
   * lookup answers. `null` means the worktree places cannot be derived yet —
   * the project places still can, so the door works from the first second. */
  worktreeRoot: string | null;
}

/** Every place a `vingilot <path>` could land: each project, and each of the
 * open project's worktrees.
 *
 * **Derived from `worktreeCwd`, which is the one derivation of "where is this
 * worktree" in the app.** A second copy here would be a second opinion about
 * the owner's disk, and the two would disagree on exactly the layout nobody
 * tested.
 *
 * Only the *open* project's worktrees, because those are the only ones the
 * workspace holds a listing for — which is why a project is a place in its own
 * right (`openTarget.ts`'s `KnownPlace.bindingId`): a path inside a project
 * whose checkouts have not been listed still lands on the project rather than
 * in the add-project dialog. */
export function knownPlaces(
  repos: readonly Repo[],
  selectedRepo: Repo | null,
  repoWorktrees: readonly Worktree[],
  worktreeRoot: string | null,
): KnownPlace[] {
  const places: KnownPlace[] = repos.map((repo) => ({
    bindingId: null,
    path: repo.path,
    repoId: repo.id,
  }));
  if (selectedRepo === null || worktreeRoot === null) return places;
  for (const worktree of repoWorktrees) {
    const path = worktreeCwd(selectedRepo, worktree, worktreeRoot);
    if (path === null) continue;
    places.push({
      bindingId: worktree.binding_id,
      path,
      repoId: selectedRepo.id,
    });
  }
  return places;
}

/** The sentence for a machine with several editors and no choice yet.
 *
 * **Never a guess, not even from a palette.** The row has no menu to draw, so
 * it says where the one-time choice is made instead of picking for him — the
 * plan's "never guess between two", held at the one door that could not obey it
 * by drawing a menu. */
export const PICK_AN_EDITOR_FIRST =
  "several editors are installed and none has been chosen yet. Pick one once from the ↗ button in the Files viewer header, and this row will use it.";

export function useEscapeHatch({
  addProject,
  openedFile,
  repoWorktrees,
  repos,
  selectRepo,
  selectWorktree,
  selectedRepo,
  showFiles,
  worktreeRoot,
}: Options): EscapeHatch {
  const [notice, setNotice] = React.useState<string | null>(null);
  const editor = useEditorAction();

  // What the ⌘K row's label is a reading of. Asked once when the workspace
  // mounts and again after an install, and never on a timer: `shim_status`
  // writes the shim before it stats the link, so a poll would be a write into
  // the owner's home directory forever for a fact that only this app's own
  // action changes.
  //
  // **The screen owns it rather than a module-level cache** (which is what
  // `useEditors.ts` needs, because five components probe): there is exactly one
  // reader here, mounted for the life of the workspace, so a singleton would
  // only add a lifetime nothing needs.
  const [shim, setShim] = React.useState<ShimLinkage | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    void readShimStatus().then((status) => {
      if (mounted.current) setShim(status);
    });
    return () => {
      mounted.current = false;
    };
  }, []);

  const openCurrentFileInEditor = React.useCallback(() => {
    // The palette row is blocked without an open file (`paletteSources.ts`), so
    // this is the same fact read twice rather than a second rule.
    if (openedFile === null || openedFile.path === null) return;
    if (editor.type === "none") {
      setNotice(editor.refusal);
      return;
    }
    if (editor.type === "ask") {
      setNotice(PICK_AN_EDITOR_FIRST);
      return;
    }
    void openInEditor(
      editor.editor,
      openedFile.worktree,
      openedFile.path,
      // No line: what the workspace holds is which file the pane has open, not
      // where in it the owner is looking. `null` is the word for that, and the
      // buttons on a search hit and in the viewer header are the doors that do
      // carry one.
      null,
    ).then(setNotice);
  }, [editor, openedFile]);

  const installShim = React.useCallback(() => {
    // Always a sentence, either way: `linked` says whether it is done or a next
    // step, and the next step is an `ln -s` he can read before running it.
    void installShimLink().then((outcome) => {
      if (!mounted.current) return;
      setNotice(outcome.sentence);
      // Re-read rather than believe `outcome.linked`: the row's label is a
      // claim about the disk, and the one place that reads the disk is the one
      // that should answer for it. It also covers the case the outcome cannot
      // describe — he ran the printed `ln -s` himself and pressed the row
      // again to check.
      void readShimStatus().then((status) => {
        if (mounted.current) setShim(status);
      });
    });
  }, []);

  const places = React.useMemo(
    () => knownPlaces(repos, selectedRepo, repoWorktrees, worktreeRoot),
    [repos, repoWorktrees, selectedRepo, worktreeRoot],
  );

  useVingilotOpen({
    // **The picker cannot be pre-filled.** `addProject` opens the OS folder
    // dialog, which takes no starting path, so the directory goes in the
    // sentence beside it rather than into the dialog. Said out loud because the
    // plan asked for "add-project pre-filled", and this is the honest half of
    // what that can be.
    addProject,
    places,
    report: setNotice,
    selectRepo,
    selectWorktree,
    showFiles,
  });

  return {
    dismissNotice: React.useCallback(() => setNotice(null), []),
    installShim,
    notice,
    openCurrentFileInEditor,
    shim,
  };
}
