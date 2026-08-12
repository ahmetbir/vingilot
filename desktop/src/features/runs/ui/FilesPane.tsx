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
import type { ThemedToken } from "shiki";

import { diffListPlacement } from "@/features/runs/lib/diffLayout";
import { type FileKind, fileKind } from "@/features/runs/lib/fileKinds";
import {
  type FilesError,
  type DirState,
  type Expanded,
  ancestors,
  enterOn,
  filesRefusal,
  flatten,
  humanCount,
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
import {
  type FileTextValue,
  readFile,
  readTree,
} from "@/features/runs/lib/filesClient";
import {
  type FileRequest,
  pendingFile,
  shouldLand,
  subscribeFileTarget,
  takeFile,
} from "@/features/runs/lib/filesTarget";
import { markedLineIndex, viewerPlan } from "@/features/runs/lib/fileViewer";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import {
  type FindLine,
  type FindMatch,
  NO_MATCHES,
  segmentSpan,
} from "@/features/runs/lib/findInFile";
import { useFindInFile } from "@/features/runs/lib/useFindInFile";
import { labelParts } from "@/features/runs/lib/worktreeDiff";
import { FindBar } from "@/features/runs/ui/FindBar";
import { PaneEmpty } from "@/features/runs/ui/PaneEmpty";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@/shared/theme/theme-loader";
import { tokenizeChunked } from "@/shared/ui/markdown/CodeBlock";

/** What the viewer is showing, or why it is not. Four states and not three:
 * `reading` is kept apart from `empty` because a file being read and no file
 * chosen look identical if they share a branch, and one of them is a wait. */
type ViewState =
  | { status: "empty" }
  | { status: "reading"; path: string }
  | { status: "read"; file: FileTextValue; line: number | null }
  | { status: "refused"; path: string; error: FilesError };

const NOTHING_OPEN: ViewState = { status: "empty" };

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
            <FileViewer paneRef={paneRef} state={view} />
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

function FileViewer({
  paneRef,
  state,
}: {
  /** The pane's own root, handed down for one reason: it is where the ⌘F
   * boundary is drawn (`findKeys.ts`'s header). */
  paneRef: React.RefObject<HTMLElement | null>;
  state: ViewState;
}) {
  if (state.status === "empty") {
    // The pane's one designed moment (`PaneEmpty`). The old single sentence
    // ("Pick a file on the left. Arrow keys move, Enter opens.") split into
    // the sentence and the keyboard hint — same words, same claims, arranged
    // as the empty-state shape every pane now shares. Not pinned by any spec;
    // stated here because rewording a state sentence is a decision, not a
    // side effect.
    return (
      <PaneEmpty
        glyph="⌸"
        hint="arrow keys move · Enter opens"
        sentence="Pick a file on the left."
        testid="files-viewer-empty"
      />
    );
  }
  if (state.status === "reading") {
    return (
      <p
        className="p-3 text-xs text-muted-foreground"
        data-testid="files-viewer-reading"
      >
        reading {state.path}…
      </p>
    );
  }
  if (state.status === "refused") {
    // **Each refusal is its own sentence** — Task 3's last checkbox. The words
    // are `filesRefusal`'s, so they are tested without a browser, and every one
    // of them names the thing in the way.
    return (
      <p
        className="p-3 text-xs text-foreground"
        data-testid="files-viewer-refusal"
      >
        {filesRefusal(state.error)}
      </p>
    );
  }

  return <FileBody file={state.file} line={state.line} paneRef={paneRef} />;
}

/** The amber wash `badge.tsx`'s warning variant already speaks and the Search
 * pane already uses for a hit — the one hue every editor uses for a find match,
 * so this is the app's existing vocabulary rather than a new colour.
 *
 * `text-foreground` is not decoration: a `<mark>` carries a UA background *and* a
 * UA colour, so a match inside a Shiki token would otherwise lose the token's
 * colour to `marktext`. On the highlighted path the token's own inline colour
 * overrides this; on the plain path this is what keeps the text readable. */
const MATCH_CLASS = "rounded-sm bg-amber-500/25 text-foreground";

/** The current match, emphasised. **The same hue, more of it, plus a ring** —
 * rather than a second colour, because the two marks mean the same thing and
 * differ only in which one he is on. A ring rather than a weight change: bold
 * would re-flow a monospace line and make the walk look like the file is moving. */
const CURRENT_MATCH_CLASS =
  "rounded-sm bg-amber-500/60 text-foreground ring-1 ring-amber-500";

/** One span of the file, drawn with the find's amber where a match covers it.
 *
 * **This is the seam between the find and the highlighter, and it works over the
 * text on purpose.** `matches` are offsets into `file.text` (`findInFile.ts`'s
 * header argues why), `offset` says where this particular span starts in that
 * same text, and `segmentSpan` does the arithmetic. So one function serves both
 * render paths: on the plain path a span is a whole line, on the highlighted path
 * it is one of Shiki's tokens, and a match that straddles two tokens arrives as
 * two segments carrying the same match index — both amber, both emphasised
 * together when it is the current one.
 *
 * With no matches on the line this renders exactly what the viewer rendered
 * before ⌘F existed: the bare text, or one coloured span. A closed find bar costs
 * the viewer no extra elements at all. */
function Painted({
  color,
  current,
  first,
  matches,
  offset,
  text,
}: {
  color: string | undefined;
  current: number;
  /** Where this line's matches start in the file's list — without it the
   * emphasis lands once per line instead of once per file (`FindLine`'s own
   * doc comment records the defect). */
  first: number;
  matches: FindMatch[];
  offset: number;
  text: string;
}) {
  const style = color === undefined ? undefined : { color };
  if (matches.length === 0) {
    if (style === undefined) return text;
    return <span style={style}>{text}</span>;
  }
  return segmentSpan(text, offset, matches, first).map((segment, at) =>
    segment.match === null ? (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reordered
        key={at}
        style={style}
      >
        {segment.text}
      </span>
    ) : (
      <mark
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reordered
        key={at}
        className={
          segment.match === current ? CURRENT_MATCH_CLASS : MATCH_CLASS
        }
        data-testid={
          segment.match === current ? "files-find-current" : "files-find-match"
        }
        style={style}
      >
        {segment.text}
      </mark>
    ),
  );
}

/** One rendered line of the viewer, either path. Empty lines render one space
 * — a block-level span with no content collapses to zero height, which is a
 * file whose blank lines have vanished (`PatchView` keeps the same rule).
 *
 * `lines` is the find's per-line match set or `null` for "no find running", and
 * it is indexed positionally — the same positional agreement between the two
 * render paths that `markedLineIndex` already depends on. */
function ViewerLines({
  current,
  lines,
  text,
  tokens,
}: {
  current: number;
  lines: FindLine[] | null;
  text: string;
  tokens: ThemedToken[][] | null;
}) {
  if (tokens !== null) {
    return tokens.map((lineTokens, index) => {
      const line = lines?.[index];
      // Where each token starts in the file, accumulated across the line.
      // Shiki tokenises the very text this walk measures — `tokenizeChunked` is
      // handed `file.text` and its tokens partition each line of it — so the
      // running total and `line.start` are two readings of one string.
      let at = line?.start ?? 0;
      return (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          key={index}
          className="block"
          data-line=""
        >
          {lineTokens.length === 0
            ? " "
            : lineTokens.map((token, tokenAt) => {
                const offset = at;
                at += token.content.length;
                return (
                  <Painted
                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
                    key={tokenAt}
                    color={token.color}
                    current={current}
                    first={line?.first ?? 0}
                    matches={line?.matches ?? NO_MATCHES}
                    offset={offset}
                    text={token.content}
                  />
                );
              })}
        </span>
      );
    });
  }
  return text.split("\n").map((lineText, index) => {
    const line = lines?.[index];
    return (
      <span
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
        key={index}
        className="block"
        data-line=""
      >
        {lineText === "" ? (
          " "
        ) : (
          <Painted
            color={undefined}
            current={current}
            first={line?.first ?? 0}
            matches={line?.matches ?? NO_MATCHES}
            offset={line?.start ?? 0}
            text={lineText}
          />
        )}
      </span>
    );
  });
}

/** Both render paths share one class list, so the background swap changes the
 * colours and nothing else: same font, same size, same `code-block-lines` line
 * numbers, no geometry to jump. `text-xs` rather than the chat block's
 * `text-sm` — the viewer's body sits beside `PatchView`'s patches and the
 * pane's own rows, and the file body is the one thing on the right side that
 * was speaking chat's size. */
const VIEWER_BODY_CLASS =
  "code-block-lines w-max min-w-full whitespace-pre font-mono text-xs text-foreground";

function FileBody({
  file,
  line,
  paneRef,
}: {
  file: FileTextValue;
  line: number | null;
  paneRef: React.RefObject<HTMLElement | null>;
}) {
  const plan = viewerPlan(file.path, file.bytes);

  // **Task 0: the tokens arrive in the background, the text never waits.**
  // The file renders as plain `data-line` spans immediately — the pane must
  // never wait on a tokeniser — and `tokenizeChunked` (the same Shiki, the
  // same caches, sliced; measurements at its definition) delivers the token
  // lines when they are ready. The answer is kept WITH the text it is an
  // answer about: a swap that outlived its file would colour the next file
  // with this one's tokens.
  const [swap, setSwap] = React.useState<{
    text: string;
    tokens: ThemedToken[][];
  } | null>(null);
  const { themeName } = useTheme();
  const shikiTheme = resolveShikiThemeName(themeName);
  React.useEffect(() => {
    if (plan.render !== "highlighted") return;
    let cancelled = false;
    void tokenizeChunked(
      file.text,
      plan.language,
      shikiTheme,
      () => cancelled,
    ).then((tokens) => {
      if (cancelled || tokens === null) return;
      setSwap({ text: file.text, tokens });
    });
    return () => {
      cancelled = true;
    };
  }, [file.text, plan.language, plan.render, shikiTheme]);
  const tokens =
    plan.render === "highlighted" && swap !== null && swap.text === file.text
      ? swap.tokens
      : null;

  // **What makes `line` a landing rather than a label.** Both render paths draw
  // one element per line — `ViewerLines` emits a `<span data-line>` per line on
  // each — so the asked-for line is found by index, marked and scrolled to,
  // whichever path rendered it. A search result that named a line and then
  // dropped him at the top of a 2,000-line file would be a door onto the wrong
  // side of the room.
  //
  // **Marked in the DOM rather than in the JSX** so the index arithmetic stays
  // one call of `markedLineIndex`, and re-marked after the background swap —
  // the swap replaces every line element, and a mark that survived only until
  // the colours arrived would be a door that closes itself.
  const bodyRef = React.useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the file and the swap are not read inside the effect, but they are what the effect reads the DOM *after* — the rows only exist once this file's text (or its tokenised replacement) has rendered, and two search hits at the same line in different files carry the same `line`. Dropping them would leave the second hit scrolled to wherever the first one left the box, and dropping `tokens` would lose the mark at the moment the swap rebuilds the rows.
  React.useEffect(() => {
    const index = markedLineIndex(line);
    if (index === null) return;
    const body = bodyRef.current;
    if (body === null) return;
    const found = body.querySelectorAll("[data-line]")[index];
    if (found === undefined) return;
    found.classList.add("bg-muted");
    found.setAttribute("data-testid", "files-viewer-marked-line");
    found.scrollIntoView({ block: "center" });
    return () => {
      found.classList.remove("bg-muted");
      found.removeAttribute("data-testid");
    };
  }, [line, file.path, file.text, tokens]);

  // **⌘F, over the text.** The hook owns the chord boundary (`findKeys.ts`'s
  // header) and the match set; what it is handed is `file.text` and never the
  // rendered spans, so the count is the same number before and after the
  // background tokenise lands. `enabled` is unconditional here because this
  // component only exists when a file is open — the empty state and the refusals
  // are earlier branches of `FileViewer`, and on those the chord stays upstream's.
  const find = useFindInFile({
    enabled: true,
    paneRef,
    text: file.text,
    viewerRef: bodyRef,
  });

  // **Walking scrolls the viewer**, which is the half that makes Enter a walk
  // rather than a counter. Read off the DOM rather than computed as a line
  // number, for the reason the marked-line effect above already records: both
  // render paths produce their own elements, and the current match is whichever
  // element carries the mark — so this is right on the plain path, on the
  // highlighted path, and across the swap between them.
  //
  // `nearest` and not `center`: he is walking matches a few lines apart, and a
  // viewer that re-centred on every Enter would move the file under him even
  // when the next match was already on screen. The landing from outside the pane
  // centres, because that is an arrival rather than a step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `find.matches` and `tokens` are not read in the effect — they are what the effect reads the DOM *after*. A keystroke that changes the match set, and the swap that rebuilds every line element, both move the mark this scrolls to.
  React.useEffect(() => {
    if (!find.open || find.current < 0) return;
    bodyRef.current
      ?.querySelector('[data-testid="files-find-current"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [find.open, find.current, find.matches, tokens]);

  const parts = labelParts(file.path);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="files-viewer">
      <div className="flex shrink-0 items-baseline gap-2 border-b border-border/60 px-2 py-1">
        {/* The shared truncation rule: the directory dims and gives way, the
            basename stays bright — the same `labelParts` arrangement the Diff
            pane's header keeps, because this line is the only place the open
            file is named at this width. */}
        <span
          className="flex min-w-0 items-baseline text-xs"
          data-testid="files-viewer-path"
          title={file.path}
        >
          {parts.lead === "" ? null : (
            <span className="min-w-0 truncate text-muted-foreground">
              {parts.lead}
            </span>
          )}
          <span className="max-w-full shrink-0 truncate text-foreground">
            {parts.name}
          </span>
        </span>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {humanCount(file.lines)} lines · {humanSize(file.bytes)}
        </span>
      </div>
      {plan.why === null ? null : (
        // The honest half of the one remaining ceiling: a file the viewer will
        // not highlight says why, in words, with the numbers. A fallback he
        // cannot see is a bug report. See `fileViewer.ts`'s header.
        <p
          className="shrink-0 border-b border-border/60 px-2 py-1 text-2xs text-muted-foreground"
          data-testid="files-viewer-plain-note"
        >
          {plan.why}
        </p>
      )}
      {/* `relative` so the find bar floats over the file rather than over the
          whole pane, and `overflow-hidden` so it is the inner box that scrolls —
          a bar inside the scrolling box would slide off the top on the first
          PageDown. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* **A focusable scroll region**, which it had to become for two reasons
            that arrived together: Escape out of the find bar has somewhere to put
            focus, and the file he is reading answers ↑↓/PageDown without a click
            first. The focus ring is upstream's inset one, so nothing moves. */}
        {/* A `<section>` rather than a div with `role="region"` — the element
            carries the role, which is what `useSemanticElements` is for. */}
        <section
          aria-label="the open file"
          className="h-full overflow-auto p-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid="files-viewer-body"
          ref={bodyRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region that cannot be reached by keyboard is a WCAG 2.1.1 failure, and `tabindex="0"` on the scroll container is the technique for it — there is no interactive element here to hang it on, because the viewer is deliberately not an editor. It is also where Escape puts focus when the find bar closes, and a bar that closed onto nothing would leave this pane keyboard-dead.
          tabIndex={0}
        >
          {plan.render === "highlighted" ? (
            // `data-highlighted` says which of the two renderings is up, so a
            // spec can assert the swap happened instead of inferring it from
            // colour counts alone.
            <pre
              className={VIEWER_BODY_CLASS}
              data-highlighted={tokens === null ? "false" : "true"}
              data-testid="files-viewer-code"
            >
              <ViewerLines
                current={find.current}
                lines={find.lines}
                text={file.text}
                tokens={tokens}
              />
            </pre>
          ) : (
            <pre className={VIEWER_BODY_CLASS} data-testid="files-viewer-plain">
              {/* `data-line` on every line and nothing about `line` here: which
                  one is marked is the effect's single answer, so the two
                  renderers cannot disagree about what "line 12" means. */}
              <ViewerLines
                current={find.current}
                lines={find.lines}
                text={file.text}
                tokens={null}
              />
            </pre>
          )}
        </section>
        {find.open ? <FindBar find={find} /> : null}
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
