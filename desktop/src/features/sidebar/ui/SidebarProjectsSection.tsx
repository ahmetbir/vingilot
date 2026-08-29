// **The sidebar's Projects section** (vingilot redesign P1; mockup sidebar
// `sec-proj`: project rows with run-state dots, worktree children indented).
//
// Fork-owned, mounted by `AppSidebar` for the channel-shaped views only — on
// /workspace the Deck accordion (`SidebarContextualPane`'s portal) is the
// projects surface, and two trees answering one question would disagree
// within a poll. Everything here is read, not derived:
//
// - **Rows** come from `paletteWorld.ts` — the snapshot the workspace
//   publishes for screens where `RunsScreen` is not mounted. That is the same
//   honesty contract `ShellPalette` runs on: the rows are what the workspace
//   last had, selecting one lands on /workspace where the live list decides.
//   (The projects *feature*'s `useProjectsQuery` is relay repositories — no
//   worktrees, no run state — so it cannot be this section's source.)
// - **Dots** are `attentionMark` over the signals honestly available outside
//   the workspace: terminal liveness from the shared `useLiveAgents` poller,
//   keyed by worktree binding id. Run status and git stat are the workspace's
//   own reads and are passed as their documented absences, never guessed.
// - **Navigation** is `requestLanding` + `goWorkspace` — `ShellPalette`'s own
//   landing path, byte for byte.

import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { attentionMark, NO_MARK } from "@/features/runs/lib/attentionSignal";
import { readWorld, subscribeWorld } from "@/features/runs/lib/paletteWorld";
import { useLiveAgents } from "@/features/runs/lib/useLiveAgents";
import { requestLanding } from "@/features/runs/lib/workspaceLanding";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/cn";

function useWorld() {
  return React.useSyncExternalStore(subscribeWorld, () => readWorld());
}

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

export function SidebarProjectsSection() {
  const world = useWorld();
  // A snapshot with nothing in it is a machine the workspace has not seen
  // yet; a section header over an empty list would be furniture. Split so the
  // liveness poller below never starts for that machine either.
  if (world.projects.length === 0) return null;
  return <SidebarProjectsSectionRows world={world} />;
}

function SidebarProjectsSectionRows({
  world,
}: {
  world: ReturnType<typeof readWorld>;
}) {
  const agents = useLiveAgents();
  const { goWorkspace } = useAppNavigation();
  const [collapsed, setCollapsed] = React.useState(false);

  const openProject = React.useCallback(
    (repoId: string) => {
      requestLanding({ bindingId: null, repoId, showFiles: false });
      void goWorkspace();
    },
    [goWorkspace],
  );
  const openWorktree = React.useCallback(
    (bindingId: string) => {
      requestLanding({ bindingId, repoId: null, showFiles: false });
      void goWorkspace();
    },
    [goWorkspace],
  );

  return (
    <div className="px-2" data-testid="sidebar-projects-section">
      <button
        className="flex w-full items-center gap-1 px-2 pb-1 pt-3 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground"
        data-testid="sidebar-projects-header"
        onClick={() => setCollapsed((prev) => !prev)}
        type="button"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3 transition-transform",
            collapsed && "-rotate-90",
          )}
        />
        Projects
      </button>
      {collapsed ? null : (
        <div className="flex flex-col" data-testid="sidebar-projects-list">
          {world.projects.map((project) => (
            <button
              className={ROW_CLASS}
              data-testid={`sidebar-project-${project.id}`}
              key={project.id}
              onClick={() => openProject(project.id)}
              title={project.path}
              type="button"
            >
              <AttentionDot mark={NO_MARK} className="ml-0.5" />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          {world.worktrees.map((worktree) => {
            const mark = attentionMark({
              agent: agents.byBinding[worktree.bindingId] ?? null,
              askInFlight: false,
              runStatus: null,
              stat: null,
            });
            return (
              <button
                className={cn(ROW_CLASS, "pl-6 text-sidebar-foreground/70")}
                data-testid={`sidebar-worktree-${worktree.bindingId}`}
                key={worktree.bindingId}
                onClick={() => openWorktree(worktree.bindingId)}
                title={worktree.detail}
                type="button"
              >
                <AttentionDot mark={mark} />
                <span className="truncate">{worktree.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
