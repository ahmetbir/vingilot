// The workspace's collapsible chrome, wired: ⌘B hides the sidebar, ⇧⌘B hides
// the worktree column, and both come back the way the owner left them, per
// project (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 6).
//
// Every decision here is somebody else's: what a chord means is
// `columnKeys.ts`, what is collapsed and how it is stored is
// `columnLayout.ts`, and the sidebar's live open/closed state belongs to
// upstream's `SidebarProvider` — this hook binds to that provider's own
// `toggleSidebar`/`setOpen` rather than building a second collapse mechanism
// beside it. What is left is the sequencing, which is the part that cannot be
// tested without React.
//
// The sidebar sync is two effects and one ref, and the ref is the whole
// subtlety: when the owner changes project we *push* the remembered state into
// the provider, and when anything else changes it — upstream's own ⌘S, the
// top-chrome trigger button, the rail — we *record* it. Without the ref the
// two would see each other's work: the push lands one commit before the
// provider reports back, so the recording effect would first see the old state
// under the new project's key and store it. `pushed` holds the value we are
// waiting to hear back and swallows exactly that echo.
//
// This hook lives with `RunsScreen`, which is mounted only on /workspace. That
// is deliberate rather than incidental: ⌘B is Tiptap's bold, and the composer
// that would lose it (features/messages) is on the screens this one is not.

import * as React from "react";

import { resolveColumnKey } from "@/features/runs/lib/columnKeys";
import {
  type ColumnLayout,
  LANDING_KEY,
  columnsFor,
  readColumnLayout,
  toggleColumn,
  withColumn,
  writeColumnLayout,
} from "@/features/runs/lib/columnLayout";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

export interface Columns {
  /** True while the selected project's worktree column is collapsed to its
   * rail. The rail is what makes the shortcut safe to have — see
   * `WorktreeColumn`. */
  worktreesCollapsed: boolean;
  toggleWorktrees: () => void;
}

interface ColumnsOptions {
  /** The project the owner is standing in, or `null` for the landing view.
   * Collapse state is remembered against this. */
  projectId: string | null;
  /** False when no worktree column is on screen (the landing view). ⇧⌘B then
   * falls through untouched rather than toggling a column that is not there —
   * a shortcut that visibly does nothing is worse than one that is unbound. */
  hasWorktreeColumn: boolean;
}

export function useColumns({
  hasWorktreeColumn,
  projectId,
}: ColumnsOptions): Columns {
  const layoutKey = projectId ?? LANDING_KEY;
  const [layout, setLayout] = React.useState<ColumnLayout>(readColumnLayout);
  React.useEffect(() => {
    writeColumnLayout(layout);
  }, [layout]);

  // `null` outside a SidebarProvider — there is no sidebar to collapse then,
  // and ⌘B does nothing rather than throwing on the way into the screen.
  const sidebar = useOptionalSidebar();
  const sidebarOpen = sidebar?.open ?? null;

  // Read by the effects below without being their dependency: the provider's
  // context object is rebuilt whenever the sidebar moves at all (open, width,
  // a drag in progress), and depending on it would re-run the push on every
  // one of those and undo the owner's last toggle.
  const latest = React.useRef({ layout, sidebar });
  React.useEffect(() => {
    latest.current = { layout, sidebar };
  });

  // The open state we told the provider to take and have not heard back yet.
  const pushed = React.useRef<boolean | null>(null);

  // Entering a project (or the landing view) restores what it looked like.
  // A project with nothing remembered inherits the chrome the owner is
  // looking at instead: collapsing the sidebar and then opening a project he
  // has never opened before must not hand it straight back to him. The
  // recording effect below stores that inherited state under the new key.
  React.useEffect(() => {
    const bar = latest.current.sidebar;
    if (bar === null) return;
    if (!Object.hasOwn(latest.current.layout, layoutKey)) {
      pushed.current = null;
      return;
    }
    const open = !columnsFor(latest.current.layout, layoutKey).sidebar;
    if (bar.open === open) {
      pushed.current = null;
      return;
    }
    pushed.current = open;
    bar.setOpen(open);
  }, [layoutKey]);

  // Anything else that moved the sidebar is the owner moving it, and belongs
  // to the project he moved it in.
  React.useEffect(() => {
    if (sidebarOpen === null) return;
    if (pushed.current !== null) {
      if (pushed.current === sidebarOpen) pushed.current = null;
      return;
    }
    setLayout((prev) => withColumn(prev, layoutKey, "sidebar", !sidebarOpen));
  }, [sidebarOpen, layoutKey]);

  const toggleWorktrees = React.useCallback(() => {
    setLayout((prev) => toggleColumn(prev, layoutKey, "worktrees"));
  }, [layoutKey]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveColumnKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      if (action.column === "sidebar") {
        const bar = latest.current.sidebar;
        if (bar === null) return;
        event.preventDefault();
        bar.toggleSidebar();
        return;
      }
      if (!hasWorktreeColumn) return;
      event.preventDefault();
      toggleWorktrees();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasWorktreeColumn, toggleWorktrees]);

  return {
    toggleWorktrees,
    worktreesCollapsed: columnsFor(layout, layoutKey).worktrees,
  };
}
