// **The sidebar's Projects section** (vingilot redesign P1.1, owner veto 4;
// mockup `.side` — Vingilot.html:83-90: a `.sh` section header with a `+`
// affordance, then project rows each carrying a `.st` status dot, with each
// project's OWN worktree children indented beneath THAT project's row).
//
// Fork-owned, mounted by `AppSidebar` for the channel-shaped views only — on
// /workspace the portalled workspace tree is the projects surface, and two
// trees answering one question would disagree within a poll. Everything here
// is read, not derived:
//
// - **Rows** come from `paletteWorld.ts` — the snapshot the workspace
//   publishes for screens where `RunsScreen` is not mounted. Since P1.1 the
//   snapshot carries every project's worktrees with their repo relation and
//   git's clean/dirty answer at publish time, so the grouping here is a read
//   of the coordinator's own `repo_id`, never a guess.
// - **The dot** is the mockup's three-state `.st` (run/ok/idle), mapped from
//   the honest signals: `run` when a live agent is working in one of the
//   project's worktrees (`useLiveAgents`, the shared poller —
//   `attentionMark`'s reading, not a second one); `ok` when git's last read
//   said every worktree is clean; `idle` otherwise — including "git never
//   answered", which is not clean.
// - **Navigation** is `requestLanding` + `goWorkspace` — `ShellPalette`'s own
//   landing path, byte for byte. The header's `+` is a door to the workspace,
//   where projects are added; it adds nothing itself.

import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { attentionMark } from "@/features/runs/lib/attentionSignal";
import {
  readWorld,
  subscribeWorld,
  type WorldWorktree,
} from "@/features/runs/lib/paletteWorld";
import { useLiveAgents } from "@/features/runs/lib/useLiveAgents";
import { requestLanding } from "@/features/runs/lib/workspaceLanding";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/cn";

function useWorld() {
  return React.useSyncExternalStore(subscribeWorld, () => readWorld());
}

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

/** The mockup's `.st` three states, and what each claims. */
type ProjectStatus = "run" | "ok" | "idle";

/** The mockup's `.st` dot: 7px, round; run=accent, ok=green, idle=faint. */
const STATUS_DOT_CLASS: Record<ProjectStatus, string> = {
  idle: "bg-sidebar-foreground/20",
  ok: "bg-[#7da97c]",
  run: "bg-primary motion-safe:animate-pulse",
};

const STATUS_SENTENCE: Record<ProjectStatus, string> = {
  idle: "idle — no live agent here, and git has not called every worktree clean",
  ok: "clean — git's last workspace read said every worktree here is clean",
  run: "working — a live agent is active in one of this project's worktrees",
};

/** The veto's own mapping, over the honest signals: any worktree with a live
 * agent → run; all worktrees clean at the last git read → ok; else idle. A
 * project with no worktree children in the snapshot can only be idle — "ok"
 * would be a claim about trees nobody read. */
export function projectStatus(
  children: readonly WorldWorktree[],
  working: (bindingId: string) => boolean,
): ProjectStatus {
  if (children.some((child) => working(child.bindingId))) return "run";
  if (children.length > 0 && children.every((child) => child.clean === true)) {
    return "ok";
  }
  return "idle";
}

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
  // The mockup header's `+`: a door to the workspace, where projects are
  // added — this section adds nothing itself (the snapshot is a copy).
  const openDeck = React.useCallback(() => {
    requestLanding({ bindingId: null, repoId: null, showFiles: false });
    void goWorkspace();
  }, [goWorkspace]);

  // One reading of "is an agent live here", shared with the dots the
  // workspace draws: `attentionMark` over the liveness poller's answer.
  const working = React.useCallback(
    (bindingId: string) =>
      attentionMark({
        agent: agents.byBinding[bindingId] ?? null,
        askInFlight: false,
        runStatus: null,
        stat: null,
      }).state !== null,
    [agents],
  );

  return (
    <div className="px-2" data-testid="sidebar-projects-section">
      <div className="flex w-full items-center gap-1 px-2 pb-1 pt-3">
        <button
          className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground"
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
        <button
          aria-label="Add project"
          className="shrink-0 rounded px-1 text-sm leading-none text-sidebar-foreground/60 hover:text-sidebar-foreground"
          data-testid="sidebar-projects-add"
          onClick={openDeck}
          title="Add project — opens the Deck, where projects are added"
          type="button"
        >
          +
        </button>
      </div>
      {collapsed ? null : (
        <div className="flex flex-col" data-testid="sidebar-projects-list">
          {world.projects.map((project) => {
            const children = world.worktrees.filter(
              (worktree) => worktree.repoId === project.id,
            );
            const status = projectStatus(children, working);
            return (
              <React.Fragment key={project.id}>
                <button
                  className={ROW_CLASS}
                  data-testid={`sidebar-project-${project.id}`}
                  onClick={() => openProject(project.id)}
                  title={`${project.path} — ${STATUS_SENTENCE[status]}`}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-[7px] w-[7px] shrink-0 rounded-full",
                      STATUS_DOT_CLASS[status],
                    )}
                    data-project-status={status}
                  />
                  <span className="truncate">{project.name}</span>
                </button>
                {children.map((worktree) => {
                  const live = working(worktree.bindingId);
                  const meta = live
                    ? "working"
                    : worktree.clean === true
                      ? "clean"
                      : worktree.clean === false
                        ? "dirty"
                        : null;
                  return (
                    <button
                      className={cn(
                        ROW_CLASS,
                        "pl-[22px] text-sidebar-foreground/70",
                      )}
                      data-testid={`sidebar-worktree-${worktree.bindingId}`}
                      key={worktree.bindingId}
                      onClick={() => openWorktree(worktree.bindingId)}
                      title={worktree.detail}
                      type="button"
                    >
                      <span className="truncate">{worktree.label}</span>
                      {meta === null ? null : (
                        <span
                          className={cn(
                            "ml-auto shrink-0 text-2xs",
                            live
                              ? "text-primary"
                              : // /60, not the mockup-faithful /40: measured
                                // 3.0:1 on the wash (P1.1 verify MAJOR-2);
                                // /60 computes 4.99:1 — the AA bar this
                                // project is held to.
                                "text-sidebar-foreground/60",
                          )}
                        >
                          {meta}
                        </span>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
