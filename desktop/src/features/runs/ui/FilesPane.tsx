// The Files pane: the viewer, at full pane width — and nothing else
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 3; design
// in vingilot/docs/plans/2026-08-12-files-pane-design.md; the tree's move out
// in vingilot/docs/plans/2026-08-14-pane-nav-absorb.md, Task 3).
//
// > *"a file he cannot open is a file he leaves to find elsewhere."*
//
// **The tree left, honestly.** It lives in the Deck sidebar's Files accordion
// member now (`SidebarFilesTree.tsx`) — not behind a flag, not `display:none`,
// removed: the drawer, its toggle, the `drawerOpen` state and the
// `diffListPlacement` call all went with it, because the thing that call was
// arbitrating space against is no longer in this pane. What remains is the
// three things that genuinely need this pane: reading the file, landing the
// targets other surfaces file, and reporting what is open.
//
// **The door from outside is unchanged** (design §6): the palette, Search's
// Enter, the Diff pane's "show the whole file" and the sidebar tree itself all
// end in `filesTarget.ts`, and this pane consumes the request — for its own
// checkout only — and opens the file at whatever line the target named.
//
// **It is a viewer and not an editor.** Nothing here writes. He has terminals
// and agents for changing things, and an editor is a different promise.
//
// **⌘F is taken here and nowhere else** (muscle-memory Task 1); the boundary
// is `lib/findKeys.ts`'s and the match set is computed over `file.text`,
// never the rendered spans.

import * as React from "react";

import { readFile } from "@/features/runs/lib/filesClient";
import {
  type FileRequest,
  pendingFile,
  shouldLand,
  subscribeFileTarget,
  takeFile,
} from "@/features/runs/lib/filesTarget";
import { parentPath } from "@/features/runs/lib/filesModel";
import type { DirState } from "@/features/runs/lib/filesModel";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import {
  FileViewer,
  NOTHING_OPEN,
  type ViewState,
} from "@/features/runs/ui/FileViewer";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

export function FilesPane({ cwd, onPaneAct }: PaneProps) {
  // `filesAvailability` has already refused a worktree with no directory, so
  // the frame is showing a sentence rather than this component. The guard is
  // for the type, and for the frames in between.
  if (cwd === null) return null;
  // Keyed by the checkout, so the record below cannot outlive the worktree it
  // is a reading of. The registry's `identity` already remounts the pane on a
  // worktree switch; this is the same guarantee for a `cwd` that resolves
  // late, which is a different event.
  return <FilesBody cwd={cwd} key={cwd} onPaneAct={onPaneAct} />;
}

function FilesBody({
  cwd,
  onPaneAct,
}: {
  cwd: string;
  onPaneAct: (act: PaneAct) => void;
}) {
  const [view, setView] = React.useState<ViewState>(NOTHING_OPEN);

  // Which read is the current one, so an answer that arrives after he has
  // moved on is dropped rather than rendered over the file he is now on. The
  // backend echoes the path back for exactly this.
  const wanted = React.useRef<string | null>(null);

  const openFile = React.useCallback(
    async (path: string, line: number | null) => {
      wanted.current = path;
      setView({ path, status: "reading" });
      // **Where he is, reported the moment he asks rather than when the read
      // lands.** A place is worktree + pane + file (`lib/placeMru.ts`). Told
      // here and not after the `await`: a file that refused is still a file
      // he opened and still where ⌃Tab should bring him back to. The same
      // report is what the sidebar's tree highlights from.
      onPaneAct({ path, type: "file-opened", worktree: cwd });
      const answered = await readFile(cwd, path);
      // Not `!==` on the state: two reads of the same path racing is fine, and
      // what must not happen is an older path's answer landing.
      if (wanted.current !== path) return;
      setView(
        answered.ok
          ? { file: answered.value, line, status: "read" }
          : { error: answered.error, path, status: "refused" },
      );
    },
    [cwd, onPaneAct],
  );

  // The door from outside (§6 of the design). A request may already be waiting
  // when this mounts — the palette files the target and *then* chooses the
  // pane, which is the sequence `RunsScreen` performs — so the pending one is
  // taken on mount as well as subscribed to. **Consumed only if it is ours, on
  // both doors** — two checkouts of one project both have `src/main.rs`, and
  // the request is a one-shot (`workspace-places.spec.ts` caught the pane
  // being unmounted swallowing another checkout's target).
  React.useEffect(() => {
    const pending = pendingFile();
    if (pending !== null && shouldLand(pending, cwd)) {
      takeFile();
      void openFile(pending.path, pending.line);
    }
    return subscribeFileTarget((request: FileRequest) => {
      if (!shouldLand(request, cwd)) return;
      takeFile();
      void openFile(request.path, request.line);
    });
  }, [cwd, openFile]);

  // **And what it has open when that is nothing.** This pane is remounted by a
  // pane switch as well as by a worktree switch and nothing here caches a file
  // across that, so a workspace still holding the last report would draw
  // "Files · src/main.rs" over a pane showing the empty state. Guarded on
  // `wanted`: a mount that landed on a pending target has already reported
  // that file — the effect above runs first, in source order — and
  // `<React.StrictMode>` runs both a second time. `onPaneAct` is read through
  // a ref so a host callback that is not reference-stable cannot turn one
  // report per mount into one per render.
  const latestAct = React.useRef(onPaneAct);
  latestAct.current = onPaneAct;
  React.useEffect(() => {
    if (wanted.current !== null) return;
    latestAct.current({ path: null, type: "file-opened", worktree: cwd });
  }, [cwd]);

  // The viewer's own box — `useFindInFile` draws ⌘F's bar on it, which is the
  // one reason the ref survives the tree's departure.
  const paneRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="pane-files"
      ref={paneRef}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <FileViewer cwd={cwd} paneRef={paneRef} state={view} />
      </div>
    </div>
  );
}

/** Kept beside the component because it is the one thing about the tree that a
 * caller outside this file may need: the directory a path lives in, for a
 * caller landing on a file it wants opened. Re-exported rather than
 * re-implemented so there is one answer. */
export { parentPath as fileParentDir };

/** What a directory currently is, for a caller that needs to read the tree's
 * state without rendering it. */
export type { DirState };
