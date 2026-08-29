// The workspace's collapsible chrome, wired: ⌘B hides the app sidebar, and it
// comes back the way the owner left it, per project
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 6).
//
// ⇧⌘B is retired (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2).
// It used to hide the workspace nav as a second, independently-collapsible
// column; that nav renders inside the app sidebar's contextual slot now, so
// there is nothing left for the chord to collapse that ⌘B does not already
// move. The per-project nav flag it drove was discarded, not migrated —
// `columnLayout.ts` reads only the sidebar flag and starting expanded is the
// safe direction, the same reasoning that module's v1→v2 discard recorded.
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

import {
  type ColumnLayout,
  LANDING_KEY,
  columnsFor,
  readColumnLayout,
  withColumn,
  writeColumnLayout,
} from "@/features/runs/lib/columnLayout";
import { useOptionalSidebar } from "@/shared/ui/sidebar";

export interface Columns {
  /** Upstream's sidebar, as this hook sees it right now. `false` outside a
   * `SidebarProvider`, where there is no sidebar to be collapsed — read as
   * "not collapsed", which is what a surface labelling the toggle should say
   * when there is nothing to toggle. */
  sidebarCollapsed: boolean;
  /** The same act ⌘B performs, for a caller that is not a keystroke — the
   * palette. Drives the provider's own `toggleSidebar`, never a second
   * collapse mechanism beside it. */
  toggleSidebar: () => void;
}

interface ColumnsOptions {
  /** The project the owner is standing in, or `null` for the landing view.
   * Collapse state is remembered against this. */
  projectId: string | null;
}

export function useColumns({ projectId }: ColumnsOptions): Columns {
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

  // Stable across renders, and reads the provider out of the ref for the same
  // reason the effects above do: the context object is rebuilt whenever the
  // sidebar moves at all.
  const toggleSidebar = React.useCallback(() => {
    latest.current.sidebar?.toggleSidebar();
  }, []);

  // The ⌘B keydown binding itself moved to the shell in redesign P1
  // (`app/useShellChords.ts`): one sidebar since the v0.3.0 merge means one
  // app-wide owner, and this hook keeps only what is workspace-shaped — the
  // per-project restore/record above, which observes the same provider state
  // the shell chord moves. `columnKeys.ts` stays as the pure map (the scratch
  // shields still resolve against it).

  return {
    sidebarCollapsed: sidebarOpen === null ? false : !sidebarOpen,
    toggleSidebar,
  };
}
