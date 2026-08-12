// The Files pane: a tree of the selected worktree on the left, a viewer on the
// right (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 3;
// design in vingilot/docs/plans/2026-08-12-files-pane-design.md).
//
// > *"a file he cannot open is a file he leaves to find elsewhere."*
//
// **This component holds effects and layout, and no decisions.** Which rows are
// drawn, what each key does, what a refusal says and whether a file is
// highlighted are all in `lib/filesModel.ts` and `lib/fileViewer.ts`, where they
// are tested with no DOM. What is left here is the three things that genuinely
// need a browser: reading the pane's own width, running the two commands, and
// putting focus where the keyboard expects it.
//
// **The tree yields to the viewer, on the Diff pane's own rule.** This pane is
// the right half of a work surface whose left half has an 80-column floor, so
// at his 1728px 16-inch it is about 440px wide and a fixed 288px tree column
// would leave the viewer 150px — which is exactly the squeeze
// `workspace-diff-fits.spec.ts` was written about. `diffListPlacement` already
// owns that arithmetic and its tests, so it is reused rather than re-derived:
// beside when both fit, a drawer over the viewer when they do not.
//
// **It is a viewer and not an editor.** Nothing here writes. He has terminals
// and agents for changing things, and an editor is a different promise — undo,
// saves, a conflict with the agent writing the same file two panes over.
//
// **⌘F is taken here and nowhere else** (muscle-memory Task 1). The chord is
// upstream's find-in-this-channel; `lib/findKeys.ts`'s header is where the
// boundary is argued and `lib/useFindInFile.ts` is where it is enforced, drawn on
// this component's own `paneRef`. The match set is computed over `file.text` and
// never over the rendered spans, which is what keeps the count and the amber the
// same before and after Task 0's background tokenise lands.

import * as React from "react";

import { diffListPlacement } from "@/features/runs/lib/diffLayout";
import { type FileKind, fileKind } from "@/features/runs/lib/fileKinds";
import {
  type DirState,
  type Expanded,
  ancestors,
  enterOn,
  flatten,
  humanSize,
  leftOf,
  parentPath,
  resolveFileTreeKey,
  rightOf,
  ROOT,
  step,
  type TreeDirs,
  type TreeRow,
  withExpanded,
} from "@/features/runs/lib/filesModel";
import { readFile, readTree } from "@/features/runs/lib/filesClient";
import {
  type FileRequest,
  pendingFile,
  shouldLand,
  subscribeFileTarget,
  takeFile,
} from "@/features/runs/lib/filesTarget";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import {
  FileViewer,
  NOTHING_OPEN,
  type ViewState,
} from "@/features/runs/ui/FileViewer";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export function FilesPane({ cwd, onPaneAct }: PaneProps) {
  // `filesAvailability` has already refused a worktree with no directory, so
  // the frame is showing a sentence rather than this component. The guard is
  // for the type, and for the frames in between.
  if (cwd === null) return null;
  // Keyed by the checkout, so the two records below cannot outlive the worktree
  // they are a reading of. The registry's `identity` already remounts the pane
  // on a worktree switch; this is the same guarantee for a `cwd` that resolves
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
  const [dirs, setDirs] = React.useState<TreeDirs>({});
  const [expanded, setExpanded] = React.useState<Expanded>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ViewState>(NOTHING_OPEN);
  // **Open to begin with, and this is the one place this pane's rule differs
  // from the Diff pane's.** The Diff pane opens on a file already (`open`
  // starts at 0), so a drawer that opened itself would cover the very patch
  // the narrow layout exists to give back — and it starts shut. This pane
  // opens on nothing, so at his width (measured: a 1728px window leaves the
  // right pane ~435px, which `diffListPlacement` resolves to `over`) a drawer
  // that started shut would be a file tree he could not see, over a viewer
  // with nothing in it. There is nothing for it to be in the way of yet.
  //
  // It is not closed for him again either — the gesture that opened it is the
  // one that puts it away, which is the Diff pane's rule and the reason
  // arrow-key navigation is not fighting a drawer that shuts on every Enter.
  const [drawerOpen, setDrawerOpen] = React.useState(true);

  // Which read is the current one, so an answer that arrives after he has
  // moved on is dropped rather than rendered over the file he is now on. The
  // backend echoes the path back for exactly this.
  const wanted = React.useRef<string | null>(null);

  const listDir = React.useCallback(
    async (dir: string) => {
      setDirs((current) =>
        current[dir]?.status === "listed"
          ? current
          : { ...current, [dir]: { status: "loading" } },
      );
      const answered = await readTree(cwd, dir);
      setDirs((current) => ({
        ...current,
        [dir]: answered.ok
          ? { listing: answered.value, status: "listed" }
          : { error: answered.error, status: "refused" },
      }));
    },
    [cwd],
  );

  // The root, once per worktree. The pane is keyed by the worktree it is a
  // reading of (`paneRegistry.tsx`'s `identity`), so a switch remounts this
  // whole component and there is no stale tree to clear.
  React.useEffect(() => {
    void listDir(ROOT);
  }, [listDir]);

  const openFile = React.useCallback(
    async (path: string, line: number | null) => {
      wanted.current = path;
      setSelected(path);
      setView({ path, status: "reading" });
      // **Where he is, reported the moment he asks rather than when the read
      // lands.** A place is worktree + pane + file (`lib/placeMru.ts`), and the
      // workspace can see the first two for itself. Told here and not after the
      // `await`: a file that refused is still a file he opened and still where
      // ⌃Tab should bring him back to, and a read that never answers must not
      // leave the trail one place behind.
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

  // **The listing is fired beside the state update, never inside it.** An
  // updater passed to `setState` has to be pure: `main.tsx` mounts this tree in
  // `<React.StrictMode>`, which double-invokes updaters in development
  // precisely to surface impurity, and `listDir` is a Tauri command that spawns
  // `git ls-files`. Expanding one directory would run two of them under `tauri
  // dev` — doubling the one cost `vingilot_files/tree.rs` is built around.
  // Reading `expanded` directly is safe here because these are gestures, not a
  // stream: a click and a `→` cannot be closer together than a render.
  const toggleDir = React.useCallback(
    (path: string) => {
      const open = expanded[path] !== true;
      if (open && dirs[path] === undefined) void listDir(path);
      setExpanded((current) => withExpanded(current, path, open));
    },
    [dirs, expanded, listDir],
  );

  // The door from outside (§6 of the design). A request may already be waiting
  // when this mounts — the palette files the target and *then* chooses the
  // pane, which is the sequence `RunsScreen` performs — so the pending one is
  // taken on mount as well as subscribed to.
  const land = React.useCallback(
    (request: FileRequest) => {
      // A target for another worktree is not this pane's: two checkouts of one
      // project both have `src/main.rs`, and landing on the wrong one silently
      // would be worse than not landing at all. The decision is `shouldLand`'s
      // so that the refusing branch has a test — a fixture with one checkout
      // can only ever produce the other one.
      if (!shouldLand(request, cwd)) return;
      // Same rule as `toggleDir`: the listings are fired here, and the updater
      // below only folds the path's ancestors open. An updater that spawned a
      // `git ls-files` per ancestor would spawn two per ancestor under
      // StrictMode, which for a file five directories down is ten processes for
      // one landing.
      const opening = ancestors(request.path).filter((dir) => dir !== ROOT);
      for (const dir of opening) {
        if (dirs[dir] === undefined) void listDir(dir);
      }
      setExpanded((current) => {
        let next = current;
        for (const dir of opening) next = withExpanded(next, dir, true);
        return next;
      });
      void openFile(request.path, request.line);
    },
    [cwd, dirs, listDir, openFile],
  );

  React.useEffect(() => {
    const pending = pendingFile();
    // **Consumed only if it is ours, on both doors.** `takeFile()` used to run
    // before the ownership check on the subscription, which made *any* live
    // Files pane swallow a target meant for another checkout — and the request
    // is a one-shot, so the pane that should have landed on it found nothing
    // waiting when it mounted. That was invisible while the only caller was the
    // Diff pane's "show the whole file", which always names the worktree already
    // on screen. ⌃Tab is the caller that does not: it files the target and
    // selects a different worktree in the same commit, so the pane being
    // unmounted hears the request first (`workspace-places.spec.ts` is what
    // caught it).
    if (pending !== null && shouldLand(pending, cwd)) {
      takeFile();
      land(pending);
    }
    return subscribeFileTarget((request) => {
      if (!shouldLand(request, cwd)) return;
      takeFile();
      land(request);
    });
  }, [cwd, land]);

  // **And what it has open when that is nothing.** The report above is made when
  // a file is opened; this is the same report made on arrival, because arriving
  // with an empty viewer is a state and not the absence of one. This pane is
  // remounted by a pane switch as well as by a worktree switch (`WorkSurface`
  // keys the slot `${pane}:${identity}`) and nothing here caches a file across
  // that, so a workspace still holding the last report would draw "Files ·
  // src/main.rs" for a pane showing the empty state, and "Files with nothing
  // open" would never be a place he could go back to (`placeMru.ts`'s
  // `FileReading`).
  //
  // **Guarded on `wanted`, which is what makes it right twice.** A mount that
  // landed on a pending target has already reported that file — the effect above
  // runs first, in source order — and `<React.StrictMode>` runs both a second
  // time, where an unconditional "nothing open" would take that file straight
  // back out of the place. `onPaneAct` is read through a ref rather than
  // depended on so that a host callback which is not reference-stable cannot
  // turn one report per mount into one per render.
  const latestAct = React.useRef(onPaneAct);
  latestAct.current = onPaneAct;
  React.useEffect(() => {
    if (wanted.current !== null) return;
    latestAct.current({ path: null, type: "file-opened", worktree: cwd });
  }, [cwd]);

  // This pane's own width: who yields to whom is decided in pixels
  // (`diffLayout.ts`) and no class name can express it. A layout effect so the
  // first paint is already the right layout rather than a 288px tree flashing
  // through a 440px pane. 0 until measured, which the placement reads as "not
  // measured" and never as "narrow".
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;
    setPaneWidth(pane.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setPaneWidth(measured);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  const placement = diffListPlacement(paneWidth);

  const rows = React.useMemo(() => flatten(dirs, expanded), [dirs, expanded]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = resolveFileTreeKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event.nativeEvent),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      event.preventDefault();
      if (action.type === "step") {
        setSelected(step(rows, selected, action.to));
        return;
      }
      if (action.type === "right") {
        const target = rightOf(rows, selected);
        if (target === null) return;
        if (target.act === "expand") toggleDir(target.path);
        else setSelected(target.path);
        return;
      }
      if (action.type === "left") {
        const target = leftOf(rows, selected);
        if (target === null) return;
        if (target.act === "collapse") toggleDir(target.path);
        else setSelected(target.path);
        return;
      }
      const target = enterOn(rows, selected);
      if (target === null) return;
      if (target.act === "open") void openFile(target.path, null);
      else toggleDir(target.path);
    },
    [openFile, rows, selected, toggleDir],
  );

  const tree = (
    <FileTree
      onKeyDown={onKeyDown}
      onOpen={(path) => void openFile(path, null)}
      onToggle={toggleDir}
      rows={rows}
      selected={selected}
    />
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="pane-files"
      ref={paneRef}
    >
      <div className="flex min-h-0 flex-1">
        {placement.where === "beside" ? (
          <div
            className="min-h-0 shrink-0 overflow-hidden border-r border-border/60"
            style={{ width: placement.listPx }}
          >
            {tree}
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {placement.where === "over" ? (
            <button
              aria-expanded={drawerOpen}
              className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              data-testid="files-tree-toggle"
              onClick={() => setDrawerOpen((open) => !open)}
              type="button"
            >
              <span aria-hidden="true">{drawerOpen ? "▾" : "▸"}</span>
              Files
            </button>
          ) : null}

          {/* `relative` HERE and not on the row above, so the drawer covers the
              viewer and not the button that closes it. The Diff pane's list
              already paid for this exact mistake — its comment records
              Playwright reporting the toggle intercepted by the drawer's own
              rows — and a drawer laid over the whole pane is a drawer with no
              way out. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <FileViewer cwd={cwd} paneRef={paneRef} state={view} />
            {placement.where === "over" && drawerOpen ? (
              // A drawer, not a replacement: the tree is one gesture away and
              // the viewer keeps the file it had.
              <div
                className="absolute inset-y-0 left-0 z-10 w-3/4 max-w-72 border-r border-border/60 bg-background shadow-lg"
                data-testid="files-tree-drawer"
              >
                {tree}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* The two differences from `ls`, said rather than left to be
          discovered: git decides what is listed, so an ignored file, a
          directory holding only ignored files, and an empty directory are all
          absent. */}
      <p
        className="shrink-0 border-t border-border/60 px-2 py-1 text-2xs text-muted-foreground"
        data-testid="files-footer"
      >
        Listed by git: ignored files, directories holding only ignored files,
        and empty directories are not shown.
      </p>
    </div>
  );
}

/** The file-kind dots, drawn the way the sidebar's unread dot and the
 * AttentionDot are drawn: a 1.5-unit `rounded-full`, tinted — never an icon
 * set. Colour is information here (which kind of thing this row is) and gray
 * is still the ground: `doc` and `other` stay neutral because this pane makes
 * no claim about them worth a hue. */
const KIND_DOT: Record<FileKind, string> = {
  code: "bg-sky-500",
  config: "bg-amber-500",
  doc: "bg-muted-foreground/40",
  image: "bg-violet-500",
  other: "bg-muted-foreground/40",
};

function FileTree({
  onKeyDown,
  onOpen,
  onToggle,
  rows,
  selected,
}: {
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
  rows: TreeRow[];
  selected: string | null;
}) {
  return (
    // `role="tree"` with one tab stop and a moving `aria-activedescendant`,
    // rather than a tab stop per row: a forty-file worktree would otherwise
    // cost forty tabs to get past, which is the opposite of reachable.
    <div
      aria-activedescendant={
        selected === null ? undefined : `files-row-${selected}`
      }
      aria-label="files in this worktree"
      className="h-full overflow-auto py-1 outline-none"
      data-testid="files-tree"
      onKeyDown={onKeyDown}
      role="tree"
      tabIndex={0}
    >
      {rows.map((row) =>
        row.row === "note" ? (
          <p
            className="px-2 py-0.5 text-2xs text-muted-foreground"
            data-testid="files-note"
            key={row.key}
            style={{ paddingLeft: 8 + row.depth * 12 }}
          >
            {row.text}
          </p>
        ) : (
          <button
            aria-expanded={row.kind === "directory" ? row.expanded : undefined}
            aria-selected={row.path === selected}
            className={`flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
              row.path === selected
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60"
            }`}
            data-testid={`files-row-${row.path}`}
            id={`files-row-${row.path}`}
            key={row.path}
            onClick={() =>
              row.kind === "file" ? onOpen(row.path) : onToggle(row.path)
            }
            role="treeitem"
            style={{ paddingLeft: 8 + row.depth * 12 }}
            tabIndex={-1}
            type="button"
          >
            {row.kind === "directory" ? (
              <span aria-hidden="true" className="w-3 shrink-0 text-center">
                {row.expanded ? "▾" : "▸"}
              </span>
            ) : (
              // The kind cue: a tinted dot, not an icon set — `KIND_DOT`.
              <span
                aria-hidden="true"
                className="flex w-3 shrink-0 items-center justify-center"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[fileKind(row.name)]}`}
                  data-kind={fileKind(row.name)}
                />
              </span>
            )}
            <span className="truncate">{row.name}</span>
            {row.size === null ? null : (
              <span className="ml-auto shrink-0 pl-2 text-2xs tabular-nums">
                {humanSize(row.size)}
              </span>
            )}
          </button>
        ),
      )}
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
