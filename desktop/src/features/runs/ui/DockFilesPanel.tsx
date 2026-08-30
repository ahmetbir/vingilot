// The dock's Files tab (redesign P3, mockup `#dp-files`): the worktree's
// tree with the mockup's file-type badges and git letters, a right-click
// menu of REAL acts, and the viewer a picked file opens into.
//
// **The tree is `SidebarFilesTree`'s model, re-hosted** — same
// `filesModel.ts` lazy per-directory reads, same keyboard map, same
// git-lists-it honesty footer. What the dock adds is the mockup's dress:
// `.flogo` type badges, `.tbadge` A/M letters cross-referenced from ONE
// `worktree_diff` read (the tree's own listing carries no git status — the
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
// **The badge letters deviate from the mockup's brand-solid chips,
// consciously.** White-on-#3178C6 measures ~4.5:1 at 8px — the exact class
// of marginal alpha-on-dark that failed four phases — so the chips here are
// the mockup's own `.flogo.md` treatment (dark chip, light letter) with a
// per-type tinted letter at comfortable contrast. The vocabulary survives;
// the illegal pixels do not.

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import * as React from "react";

import { type FileKind, fileKind } from "@/features/runs/lib/fileKinds";
import { readFile, readTree } from "@/features/runs/lib/filesClient";
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
import {
  FileViewer,
  NOTHING_OPEN,
  type ViewState,
} from "@/features/runs/ui/FileViewer";
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

/** The mockup's `.flogo`, at legal contrast (see header): a letter per
 * file family, tinted, on the `.flogo.md` dark chip. `null` families keep
 * the tree's established kind-dot. */
function flogoOf(name: string): { label: string; tint: string } | null {
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (ext === "ts" || ext === "tsx" || ext === "mts") {
    return { label: "TS", tint: "text-sky-300" };
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return { label: "JS", tint: "text-yellow-200" };
  }
  if (ext === "rs") return { label: "RS", tint: "text-orange-300" };
  if (ext === "swift") return { label: "S", tint: "text-orange-300" };
  if (ext === "md" || ext === "mdx") {
    return { label: "M", tint: "text-foreground/80" };
  }
  if (ext === "yml" || ext === "yaml") {
    return { label: "Y", tint: "text-violet-300" };
  }
  if (ext === "json") return { label: "J", tint: "text-foreground/80" };
  if (ext === "css") return { label: "C", tint: "text-sky-300" };
  return null;
}

/** A drawn tree line that is an entry — the only rows the menu acts on. */
type EntryRow = Extract<TreeRow, { row: "entry" }>;

const KIND_DOT: Record<FileKind, string> = {
  code: "bg-sky-500",
  config: "bg-amber-500",
  doc: "bg-muted-foreground/40",
  image: "bg-violet-500",
  other: "bg-muted-foreground/40",
};

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
  const [view, setView] = React.useState<ViewState>(NOTHING_OPEN);
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

  // The viewer half — `FilesPane.tsx`'s read discipline, re-hosted with the
  // tree it answers: superseded answers are dropped on the echoed path.
  const wanted = React.useRef<string | null>(null);
  const openFile = React.useCallback(
    async (path: string, line: number | null) => {
      wanted.current = path;
      setSelected(path);
      setView({ path, status: "reading" });
      onPaneAct({ path, type: "file-opened", worktree: cwd });
      const answered = await readFile(cwd, path);
      if (wanted.current !== path) return;
      setView(
        answered.ok
          ? { file: answered.value, line, status: "read" }
          : { error: answered.error, path, status: "refused" },
      );
    },
    [cwd, onPaneAct],
  );

  const closeViewer = React.useCallback(() => {
    wanted.current = null;
    setView(NOTHING_OPEN);
    onPaneAct({ path: null, type: "file-opened", worktree: cwd });
  }, [cwd, onPaneAct]);

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
      void openFile(request.path, request.line);
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

  // And the empty report on a mount that landed nothing — `FilesPane.tsx`'s
  // rule, kept: the workspace must not hold a file this panel is not showing.
  const latestAct = React.useRef(onPaneAct);
  latestAct.current = onPaneAct;
  React.useEffect(() => {
    if (wanted.current !== null) return;
    latestAct.current({ path: null, type: "file-opened", worktree: cwd });
  }, [cwd]);

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

  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const viewing = view.status !== "empty";

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="dock-files"
      ref={paneRef}
    >
      {viewing ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1">
            <button
              className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              data-testid="dock-files-back"
              onClick={closeViewer}
              type="button"
            >
              ‹ tree
            </button>
            <span className="truncate font-mono text-2xs text-muted-foreground">
              {view.status === "read" ? view.file.path : view.path}
            </span>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <FileViewer cwd={cwd} paneRef={paneRef} state={view} />
          </div>
        </>
      ) : (
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
                  onCopyPath={() =>
                    void writeTextToClipboard(absolute(row.path))
                  }
                  onNewTerminal={() => newTerminalAt(row)}
                  onOpen={() =>
                    row.kind === "file"
                      ? void openFile(row.path, null)
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
            Listed by git: ignored files, directories holding only ignored
            files, and empty directories are not shown.
          </p>
        </div>
      )}
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
  const flogo = row.kind === "file" ? flogoOf(row.name) : null;
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
            <span
              aria-hidden="true"
              className="w-3 shrink-0 text-center text-2xs"
            >
              {row.expanded ? "▾" : "▸"}
            </span>
          ) : flogo === null ? (
            <span
              aria-hidden="true"
              className="flex w-3 shrink-0 items-center justify-center"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[fileKind(row.name)]}`}
                data-kind={fileKind(row.name)}
              />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-foreground/[.16] px-0.5 font-mono text-2xs font-bold ${flogo.tint}`}
              data-testid={`dock-files-flogo-${row.path}`}
            >
              {flogo.label}
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
