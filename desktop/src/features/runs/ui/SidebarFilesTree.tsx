// The worktree's file tree, hosted by the Deck sidebar's Files accordion
// member (vingilot/docs/plans/2026-08-14-pane-nav-absorb.md, Task 3).
//
// **This is `FilesPane.tsx`'s list half, moved — not re-derived.** The model
// (`resolveFileTreeKey`, `flatten`, `step`/`leftOf`/`rightOf`/`enterOn`), the
// lazy per-directory `readTree`, the `role="tree"`/`aria-activedescendant`
// wiring and the test ids (`files-tree`, `files-row-*`) all came across
// verbatim; what changed is the mount point and the door. A row that used to
// call the pane's own `openFile` now fires the same
// `onPaneAct({ type: "show-file", … })` act Search's Enter and the Diff
// pane's "show the whole file" already fire — one landing, one more door
// (§3.1). The pane answers by opening the file at full width; there is no
// drawer left for this tree to be.
//
// **Scope: whichever worktree is currently selected.** The host keys this
// component by `cwd`, so a worktree switch remounts it onto the new checkout —
// including a switch made while the Worktrees member is collapsed, which is
// the plan's own named riskiest sequence (§8) and has its own e2e test.
//
// **The selection mirrors the pane's report rather than owning a second
// answer.** `openedFile` is the pane's own `file-opened` report, held by
// `RunsScreen`; when it names a file in this checkout, the tree selects it and
// folds its ancestors open. That is what keeps a file opened from OUTSIDE the
// tree — a search hit, a patch's file, ⌃Tab — highlighted here without the
// tree ever asking anyone what is open.

import * as React from "react";

import { type FileKind, fileKind } from "@/features/runs/lib/fileKinds";
import { readTree } from "@/features/runs/lib/filesClient";
import {
  type Expanded,
  ancestors,
  enterOn,
  flatten,
  humanSize,
  leftOf,
  resolveFileTreeKey,
  rightOf,
  ROOT,
  step,
  type TreeDirs,
  type TreeRow,
  withExpanded,
} from "@/features/runs/lib/filesModel";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import type { FileReport } from "@/features/runs/lib/placeMru";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export function SidebarFilesTree({
  cwd,
  onPaneAct,
  openedFile,
}: {
  cwd: string;
  onPaneAct: (act: PaneAct) => void;
  /** The Files pane's own report of what it has open (`file-opened`), so the
   * tree can highlight and reveal it without a second answer existing. */
  openedFile: FileReport | null;
}) {
  const [dirs, setDirs] = React.useState<TreeDirs>({});
  const [expanded, setExpanded] = React.useState<Expanded>({});
  const [selected, setSelected] = React.useState<string | null>(null);

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

  // The root, once per worktree — the host keys this component by `cwd`, so a
  // switch remounts it and there is no stale tree to clear.
  React.useEffect(() => {
    void listDir(ROOT);
  }, [listDir]);

  // The listing is fired beside the state update, never inside it —
  // `FilesPane.tsx`'s StrictMode rule, unchanged: an updater that spawned
  // `git ls-files` would spawn two of them under the dev build's double
  // invoke.
  const toggleDir = React.useCallback(
    (path: string) => {
      const open = expanded[path] !== true;
      if (open && dirs[path] === undefined) void listDir(path);
      setExpanded((current) => withExpanded(current, path, open));
    },
    [dirs, expanded, listDir],
  );

  const openFile = React.useCallback(
    (path: string) => {
      setSelected(path);
      // The one door (§3.1): the same act shape Search fires on Enter and the
      // Diff pane fires from its header. `RunsScreen` files the target and
      // brings the Files pane forward; the viewer does the reading.
      onPaneAct({ line: null, path, type: "show-file", worktree: cwd });
    },
    [cwd, onPaneAct],
  );

  // Mirror the pane's report: a file opened from anywhere — this tree, a
  // search hit, a patch, ⌃Tab — is selected here and its ancestors folded
  // open. Listings are fired outside the updater, same rule as `toggleDir`.
  // `dirs` is read through a ref, not reacted to: re-running this on every
  // listing that lands would re-select the reported file after the owner has
  // moved the cursor on.
  const dirsNow = React.useRef(dirs);
  dirsNow.current = dirs;
  React.useEffect(() => {
    if (openedFile === null || openedFile.path === null) return;
    if (openedFile.worktree !== cwd) return;
    const path = openedFile.path;
    setSelected(path);
    const opening = ancestors(path).filter((dir) => dir !== ROOT);
    for (const dir of opening) {
      if (dirsNow.current[dir] === undefined) void listDir(dir);
    }
    setExpanded((current) => {
      let next = current;
      for (const dir of opening) next = withExpanded(next, dir, true);
      return next;
    });
  }, [openedFile, cwd, listDir]);

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
      if (target.act === "open") openFile(target.path);
      else toggleDir(target.path);
    },
    [openFile, rows, selected, toggleDir],
  );

  return (
    <div className="flex w-full flex-col">
      <FileTree
        onKeyDown={onKeyDown}
        onOpen={openFile}
        onToggle={toggleDir}
        rows={rows}
        selected={selected}
      />
      {/* The two differences from `ls`, said rather than left to be
          discovered — moved here with the tree it describes. */}
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

/** The file-kind dots — `FilesPane.tsx`'s own vocabulary, moved with the tree:
 * a 1.5-unit `rounded-full`, tinted, never an icon set. `doc` and `other`
 * stay neutral because this tree makes no claim about them worth a hue. */
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
      className="w-full overflow-x-hidden py-1 outline-none"
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
