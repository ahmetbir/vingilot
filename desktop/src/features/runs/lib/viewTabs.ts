// Pure model for the tabs in the terminal strip that are NOT terminals — a
// file being read, a commit's patch, this worktree's diff (redesign P4.1,
// items 3 and 4: "gerekirse hatta bence terminalin oldugu kisimda yeni tab
// gibi acilmali", "file'lara basinca yine terminalin oldugu yerde tab gibi
// acilmali").
//
// **A view tab is not a terminal ordinal, and that separation is the whole
// design.** `terminalTabs.ts`'s ordinal is the name of a PTY session
// (`sessionIdFor`), `taskStrip.ts` groups those ordinals, `terminalSplit.ts`
// halves them, `terminalTabStore.ts` writes them to disk and the orphan
// sweeper reconciles the tmux sessions against them. Threading a "this one is
// a file" flag through that stack would put a thing with no pty inside every
// one of those rules — and `WorkSurface`'s own header says why that is the
// dangerous direction: a terminal that changes parents is a new xterm, a fresh
// attach, and a replay into a box that has not been laid out. So the shells
// keep their model untouched, this is a second list beside it, and the two
// meet in exactly one place: which of them the surface is showing.
//
// **Identity, not instance.** Opening `src/main.rs` twice gives one tab, not
// two — `viewId` is derived from what the tab is a view OF, so the second
// open focuses the first (and updates the line it was asked for). That is what
// every editor does, and it is also what keeps a tree the owner is clicking
// through from filling the strip with forty tabs.
//
// **Nothing here is persisted, deliberately.** A terminal tab survives a
// restart because a tmux session survives one and the layout has to meet it. A
// view tab is a *read* — of a file as it is now, of a patch as git reports it
// now — and restoring one from last week's storage would put a stale reading
// on screen wearing a live tab's chrome. Reopening costs one click in the dock,
// which is where browsing lives.

/** What a view tab is a view of. */
export type ViewSubject =
  | {
      kind: "file";
      /** Worktree-relative, the same shape `filesTarget.ts` carries. */
      path: string;
      /** 1-based, or `null` for the top of the file. */
      line: number | null;
    }
  | {
      kind: "commit";
      /** The full hash — what `commit_diff` is asked with. */
      hash: string;
      /** git's own abbreviation, for the tab's label. */
      short: string;
    }
  | {
      kind: "diff";
      /** The ref the working tree is compared against. */
      base: string;
    };

export interface ViewTab {
  /** Stable for the life of the tab, and derived from the subject: opening the
   * same thing again lands on the tab that is already open. */
  readonly id: string;
  readonly subject: ViewSubject;
}

export interface WorktreeViews {
  /** Strip order, left to right — the order they were opened in. */
  readonly tabs: readonly ViewTab[];
  /** The view showing, or `null` when a terminal is. **Not "the last view" —
   * the actual selection**: the surface shows a terminal exactly when this is
   * `null`, so every path that puts a shell back on screen clears it. */
  readonly active: string | null;
}

export type ViewLayout = Readonly<Record<string, WorktreeViews>>;

const NONE: WorktreeViews = { active: null, tabs: [] };

export function emptyViews(): ViewLayout {
  return {};
}

/** One worktree's view tabs — never `null`, because a worktree with no views
 * and a worktree nobody has visited are the same thing to every reader here. */
export function worktreeViews(
  layout: ViewLayout,
  bindingId: string,
): WorktreeViews {
  return Object.hasOwn(layout, bindingId) ? layout[bindingId] : NONE;
}

/** What a subject is called, for the tab's own label. A file is its basename
 * (the path is the `title`), a commit is its short hash, the diff is the word.
 * Short on purpose: the strip is one row beside the shells. */
export function viewLabel(subject: ViewSubject): string {
  if (subject.kind === "file") {
    const at = subject.path.lastIndexOf("/");
    return at === -1 ? subject.path : subject.path.slice(at + 1);
  }
  if (subject.kind === "commit") return subject.short;
  return "diff";
}

/** The full sentence the tab carries as its `title` — the basename alone is
 * ambiguous in any repository with two `mod.rs` in it. */
export function viewTitle(subject: ViewSubject): string {
  if (subject.kind === "file") {
    return subject.line === null
      ? subject.path
      : `${subject.path}:${subject.line}`;
  }
  if (subject.kind === "commit") return `commit ${subject.short}`;
  return `working tree against ${subject.base}`;
}

/** The identity two opens of one thing share.
 *
 * The line is deliberately NOT part of a file's identity: "open `main.rs` at
 * line 40" while `main.rs` is already open is a jump inside the tab that is
 * there, never a second tab for one file. */
export function viewId(subject: ViewSubject): string {
  if (subject.kind === "file") return `file:${subject.path}`;
  if (subject.kind === "commit") return `commit:${subject.hash}`;
  return `diff:${subject.base}`;
}

function replace(
  layout: ViewLayout,
  bindingId: string,
  views: WorktreeViews,
): ViewLayout {
  return { ...layout, [bindingId]: views };
}

/** Open a view, or focus the one already open for it.
 *
 * A re-open carries its subject in — the line a file was asked for changes,
 * the tab does not. New tabs land at the end of the strip, the same rule
 * `terminalTabs.ts`'s `addTab` keeps and for the same reason: the strip reads
 * in the order things were opened. */
export function openView(
  layout: ViewLayout,
  bindingId: string,
  subject: ViewSubject,
): ViewLayout {
  const views = worktreeViews(layout, bindingId);
  const id = viewId(subject);
  const at = views.tabs.findIndex((tab) => tab.id === id);
  if (at === -1) {
    return replace(layout, bindingId, {
      active: id,
      tabs: [...views.tabs, { id, subject }],
    });
  }
  const tabs = [...views.tabs];
  tabs[at] = { id, subject };
  return replace(layout, bindingId, { active: id, tabs });
}

/** Show a view that is already open. A id naming no tab changes nothing —
 * `applyTabCommand`'s rule for a stray command, kept. */
export function selectView(
  layout: ViewLayout,
  bindingId: string,
  id: string,
): ViewLayout {
  const views = worktreeViews(layout, bindingId);
  if (!views.tabs.some((tab) => tab.id === id)) return layout;
  if (views.active === id) return layout;
  return replace(layout, bindingId, { ...views, active: id });
}

/** Close one view.
 *
 * **Closing the showing one falls back to a neighbour, then to the
 * terminals.** A view tab has nothing behind it that must stay reachable — no
 * pty, no session — so unlike `closeTab` there is no "never leave the strip
 * empty" rule to keep: the honest landing place when the last view closes is
 * the shells, which were never gone. */
export function closeView(
  layout: ViewLayout,
  bindingId: string,
  id: string,
): ViewLayout {
  const views = worktreeViews(layout, bindingId);
  const at = views.tabs.findIndex((tab) => tab.id === id);
  if (at === -1) return layout;
  const tabs = views.tabs.filter((tab) => tab.id !== id);
  if (views.active !== id)
    return replace(layout, bindingId, { ...views, tabs });
  const landing = tabs[Math.min(at, tabs.length - 1)];
  return replace(layout, bindingId, {
    active: landing === undefined ? null : landing.id,
    tabs,
  });
}

/** Put the terminals back on screen without closing anything — what every
 * gesture that selects, opens, steps or closes a SHELL does on its way. */
export function clearActiveView(
  layout: ViewLayout,
  bindingId: string,
): ViewLayout {
  const views = worktreeViews(layout, bindingId);
  if (views.active === null) return layout;
  return replace(layout, bindingId, { ...views, active: null });
}

/** The showing view, or `null` when a terminal is showing. */
export function activeView(views: WorktreeViews): ViewTab | null {
  if (views.active === null) return null;
  return views.tabs.find((tab) => tab.id === views.active) ?? null;
}

/** Which file the workspace has open — the answer ⌘K's current-file row, the
 * escape hatch and `placeMru.ts` all ask for.
 *
 * **Derived, not reported.** Before P4.1 the Files pane sent the workspace a
 * `file-opened` act, which meant it could only speak while it was mounted:
 * hence the `null` on every unmount and the "is this report still live" rule
 * beside it. A file is a TAB now, so the answer is visible from outside — the
 * tab showing IS what is open — and a `path` of `null` means nothing is open
 * because nothing is.
 *
 * `cwd` of `null` is a workspace standing in no checkout, which has no file
 * open and no worktree to name one against. */
export function openFileReport(
  views: WorktreeViews,
  cwd: string | null,
): { worktree: string; path: string | null } | null {
  if (cwd === null) return null;
  const showing = activeView(views);
  const path =
    showing !== null && showing.subject.kind === "file"
      ? showing.subject.path
      : null;
  return { path, worktree: cwd };
}

/** Forget the worktrees the tab model no longer holds. Closes nothing, because
 * a view owns nothing to close — the same argument `pruneTasks` makes, with
 * one fewer thing to be careful about. */
export function pruneViews(
  layout: ViewLayout,
  liveBindingIds: readonly string[],
): ViewLayout {
  const live = new Set(liveBindingIds);
  const kept: Record<string, WorktreeViews> = {};
  let dropped = false;
  for (const [bindingId, views] of Object.entries(layout)) {
    if (live.has(bindingId)) kept[bindingId] = views;
    else dropped = true;
  }
  return dropped ? kept : layout;
}
