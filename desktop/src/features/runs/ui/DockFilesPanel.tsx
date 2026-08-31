// The dock's Files tab (redesign P3, mockup `#dp-files`): the worktree's
// tree with per-language icons and git letters, and a right-click menu of
// REAL acts.
//
// **The dock browses; the tab reads** (P4.1, item 4: "file'lara basinca yine
// terminalin oldugu yerde tab gibi acilmali"). Picking a file no longer opens
// a viewer inside this 300-540px card — it asks the workspace for a view tab
// beside the shells (`viewTabs.ts`), which gets the whole stage. The tree
// keeps everything that is about *finding* a file: the selection, the folded
// ancestors, the git letters, the menu. What left is the half that was always
// too narrow.
//
// **The tree is `filesModel.ts`'s** — lazy per-directory reads, the same
// keyboard map, the same git-lists-it honesty footer. What the dock adds is
// the mockup's dress: type icons, `.tbadge` A/M letters cross-referenced from
// ONE `worktree_diff` read (the tree's own listing carries no git status — the
// letters come from the Diff pane's read or they do not exist), and the
// `.ctx` context menu.
//
// **The context menu holds exactly the acts with a backend today.** Open
// (the viewer), Reveal in Finder (`revealItemInDir` — the opener plugin's
// permission is already granted), Copy path (the clipboard helper every
// settings card uses), New terminal here (a fresh tab with `cd <dir>` typed
// into it — the `run-in-new-terminal` act, down the pty channel a keystroke
// uses). The mockup's Rename / Delete / Discard changes / Ask agent / Open
// to the side rows have NO backend in this app and are omitted entirely —
// the no-fake rule: an act that cannot happen does not get a button, not
// even a disabled one.
//
// **The icons are the ONE place the mockup is overruled, and the owner
// overruled it**: "sagdaki filetreedeki ikonlar sacma. direk vscodedaki gibi
// dile gore olmali, design orda yanlis yapmis." The mockup's `.flogo` lettered
// chips — an "S" on every Swift file — are replaced by per-language glyphs
// (`lib/fileIcons.ts`, `ui/FileIcon.tsx`), which is the licence's whole
// extent: the folder glyph below is still the mockup's own path, and
// "dizayna sadik kal" stands everywhere else on this surface.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as React from "react";

import { fileIconId } from "@/features/runs/lib/fileIcons";
import { readTree } from "@/features/runs/lib/filesClient";
import {
  type Expanded,
  ancestors,
  enterOn,
  flatten,
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
import {
  type FileRequest,
  pendingFile,
  shouldLand,
  subscribeFileTarget,
  takeFile,
} from "@/features/runs/lib/filesTarget";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import { shellEscapePath } from "@/features/runs/lib/shellEscape";
import {
  changeMark,
  changeMarkClass,
  defaultDiffBase,
  type DiffChange,
} from "@/features/runs/lib/worktreeDiff";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import { FileIcon } from "@/features/runs/ui/FileIcon";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";

export function DockFilesPanel({ cwd, onPaneAct, worktree }: PaneProps) {
  if (cwd === null) return null;
  const base = worktree === null ? "HEAD" : defaultDiffBase(worktree);
  return <FilesBody base={base} cwd={cwd} key={cwd} onPaneAct={onPaneAct} />;
}

/** A drawn tree line that is an entry — the only rows the menu acts on. */
type EntryRow = Extract<TreeRow, { row: "entry" }>;

function FilesBody({
  base,
  cwd,
  onPaneAct,
}: {
  base: string;
  cwd: string;
  onPaneAct: (act: PaneAct) => void;
}) {
  const [dirs, setDirs] = React.useState<TreeDirs>({});
  const [expanded, setExpanded] = React.useState<Expanded>({});
  const [selected, setSelected] = React.useState<string | null>(null);
  // The one `worktree_diff` read the `.tbadge` letters come from. `null`
  // until it answers; a refusal stays `null` — no letters is an honest
  // reading, wrong letters are not.
  const [marks, setMarks] = React.useState<Map<string, DiffChange> | null>(
    null,
  );

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

  React.useEffect(() => {
    void listDir(ROOT);
  }, [listDir]);

  React.useEffect(() => {
    let alive = true;
    void gitWorktreeDiff(cwd, base).then((read) => {
      if (!alive || !read.ok) return;
      setMarks(
        new Map(read.value.files.map((file) => [file.path, file.change])),
      );
    });
    return () => {
      alive = false;
    };
  }, [cwd, base]);

  const toggleDir = React.useCallback(
    (path: string) => {
      const open = expanded[path] !== true;
      if (open && dirs[path] === undefined) void listDir(path);
      setExpanded((current) => withExpanded(current, path, open));
    },
    [dirs, expanded, listDir],
  );

  // Opening a file is now two things and neither of them is a read: the row is
  // selected here, and the workspace is asked for a tab (P4.1 item 4). No
  // `readFile` on this path at all — the tab does its own, at the width the
  // text needs.
  const openFile = React.useCallback(
    (path: string, line: number | null) => {
      setSelected(path);
      onPaneAct({
        type: "open-view",
        view: { kind: "file", line, path },
        worktree: cwd,
      });
    },
    [cwd, onPaneAct],
  );

  // The door from outside (`filesTarget.ts`): pending-then-subscribe, and a
  // landed target folds its ancestors open so the tree agrees with the viewer.
  const dirsNow = React.useRef(dirs);
  dirsNow.current = dirs;
  const land = React.useCallback(
    (request: FileRequest) => {
      const opening = ancestors(request.path).filter((dir) => dir !== ROOT);
      for (const dir of opening) {
        if (dirsNow.current[dir] === undefined) void listDir(dir);
      }
      setExpanded((current) => {
        let next = current;
        for (const dir of opening) next = withExpanded(next, dir, true);
        return next;
      });
      openFile(request.path, request.line);
    },
    [listDir, openFile],
  );
  React.useEffect(() => {
    const pending = pendingFile();
    if (pending !== null && shouldLand(pending, cwd)) {
      takeFile();
      land(pending);
    }
    return subscribeFileTarget((request: FileRequest) => {
      if (!shouldLand(request, cwd)) return;
      takeFile();
      land(request);
    });
  }, [cwd, land]);

  // The empty report this panel used to send on a mount that landed nothing is
  // gone with the viewer that needed it: "which file is open" is the view
  // tabs' answer now (`RunsScreen` derives it), and a tree that also claimed
  // to know would be the second answer `paneModel.ts` warns about.

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
      if (target.act === "open") openFile(target.path, null);
      else toggleDir(target.path);
    },
    [openFile, rows, selected, toggleDir],
  );

  // The context menu's real acts. Paths shown and copied are absolute — the
  // mockup's `.ctxh` shows the full path for the same reason.
  const absolute = (path: string) => (path === "" ? cwd : `${cwd}/${path}`);
  const newTerminalAt = (row: EntryRow) => {
    const dir =
      row.kind === "directory" ? row.path : (parentPath(row.path) ?? ROOT);
    onPaneAct({
      text: `cd ${shellEscapePath(absolute(dir))}\n`,
      type: "run-in-new-terminal",
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="dock-files">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          aria-activedescendant={
            selected === null ? undefined : `dock-files-row-${selected}`
          }
          aria-label="files in this worktree"
          className="w-full py-1 outline-none"
          data-testid="dock-files-tree"
          onKeyDown={onKeyDown}
          role="tree"
          tabIndex={0}
        >
          {rows.map((row) =>
            row.row === "note" ? (
              <p
                className="px-2 py-0.5 text-2xs text-muted-foreground"
                key={row.key}
                style={{ paddingLeft: 8 + row.depth * 12 }}
              >
                {row.text}
              </p>
            ) : (
              <TreeRowButton
                key={row.path}
                mark={
                  row.kind === "file" ? (marks?.get(row.path) ?? null) : null
                }
                onCopyPath={() => void writeTextToClipboard(absolute(row.path))}
                onNewTerminal={() => newTerminalAt(row)}
                onOpen={() =>
                  row.kind === "file"
                    ? openFile(row.path, null)
                    : toggleDir(row.path)
                }
                onReveal={() => void revealItemInDir(absolute(row.path))}
                path={absolute(row.path)}
                row={row}
                selected={row.path === selected}
              />
            ),
          )}
        </div>
        <p
          className="mt-auto shrink-0 border-t border-border/60 px-2 py-1 text-2xs text-muted-foreground"
          data-testid="dock-files-footer"
        >
          Listed by git: ignored files, directories holding only ignored files,
          and empty directories are not shown.
        </p>
      </div>
    </div>
  );
}

function TreeRowButton({
  mark,
  onCopyPath,
  onNewTerminal,
  onOpen,
  onReveal,
  path,
  row,
  selected,
}: {
  mark: DiffChange | null;
  onCopyPath: () => void;
  onNewTerminal: () => void;
  onOpen: () => void;
  onReveal: () => void;
  /** Absolute — what Reveal and Copy act on, and what the menu header shows. */
  path: string;
  row: EntryRow;
  selected: boolean;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          aria-expanded={row.kind === "directory" ? row.expanded : undefined}
          aria-selected={selected}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
            selected
              ? "bg-[var(--vingilot-accent-soft)] text-[var(--vingilot-accent-text)]"
              : "text-foreground/80 hover:bg-foreground/5"
          }`}
          data-testid={`dock-files-row-${row.path}`}
          id={`dock-files-row-${row.path}`}
          onClick={onOpen}
          role="treeitem"
          style={{ paddingLeft: 8 + row.depth * 12 }}
          tabIndex={-1}
          type="button"
        >
          {row.kind === "directory" ? (
            // The mockup's own pair: the chevron, then its folder glyph.
            <>
              <span
                aria-hidden="true"
                className="w-3 shrink-0 text-center text-2xs"
              >
                {row.expanded ? "▾" : "▸"}
              </span>
              <span data-testid={`dock-files-icon-${row.path}`}>
                <FileIcon id="folder" />
              </span>
            </>
          ) : (
            // A file's own language, in place of the mockup's lettered chip —
            // the owner's single licensed deviation (see this file's header).
            // Where the mockup's `.tspacer` was: the tree still lines up,
            // because a file has no chevron and a directory has no name-column
            // shift.
            <span
              className="ml-3 flex shrink-0"
              data-testid={`dock-files-icon-${row.path}`}
            >
              <FileIcon id={fileIconId(row.name)} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {mark === null ? null : (
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded bg-foreground/[.08] font-mono text-2xs font-bold ${changeMarkClass(mark)}`}
              data-testid={`dock-files-mark-${row.path}`}
              title={`git: ${changeMark(mark)}`}
            >
              {changeMark(mark)}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[200px]">
        <ContextMenuLabel className="max-w-[260px] truncate font-mono text-2xs font-normal text-muted-foreground">
          {path}
        </ContextMenuLabel>
        <ContextMenuItem data-testid="dock-files-ctx-open" onSelect={onOpen}>
          Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="dock-files-ctx-reveal"
          onSelect={onReveal}
        >
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="dock-files-ctx-copy"
          onSelect={onCopyPath}
        >
          Copy path
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="dock-files-ctx-terminal"
          onSelect={onNewTerminal}
        >
          New terminal here
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
