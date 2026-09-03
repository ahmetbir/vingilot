// The one tab strip, with every open worktree standing on it (2026-09-03).
//
// > *"Worktree değistirince hero terminalin değişmesi yoruyor. Diyorum ki
// > acaba bi sekilde terminali sabit tutup worktreeye basınca o worktree icin
// > o isimli tab mi eklese sadece?"*
//
// **What it draws.** One chip per worktree that has tabs open, in the hero
// order (`heroOrder.ts`). The focused worktree's chip is expanded: its own
// `TerminalTabStrip` — the same component, the same tabs, tasks, views and
// split it has always drawn — follows the chip. Every other chip is
// collapsed to its branch and its tab count. Pressing a collapsed chip
// focuses that worktree, which is the act the nav row performs too; the
// strip does not move, the chip opens where it stands.
//
// **Leaving is the chip's ×.** A worktree's tabs used to be unclosable in the
// sense that closing the last one opened a fresh shell (`closeTab`); on one
// strip that would mean worktrees accumulate forever. The × is the way off
// the strip: it ends that worktree's shells and, if it was the focused one,
// focus moves to its neighbour (`neighbourOf`). The tab model is not
// changed for this — it is `closeWorktrees`, the same act the nav's remove
// performs, reached from the strip.
//
// **Tasks stay per-worktree.** A task is the shells of one checkout; a strip
// that spans checkouts does not change what a task is, so the chips under
// the tab bar still belong to the focused worktree alone. Stated because it
// was the open question in the plan, and this is the answer taken.

import { X } from "lucide-react";
import * as React from "react";

import type { Worktree } from "@/features/runs/lib/projects";

export interface HeroStripProps {
  /** Open worktrees in strip order — `heroOrder.ts`'s reconciled list. */
  order: readonly string[];
  selectedWorktreeId: string | null;
  /** For chip labels; a worktree not found here is drawn by its id. */
  worktrees: readonly Worktree[];
  /** Open tabs per worktree, for the collapsed chips' counts. */
  tabCounts: ReadonlyMap<string, number>;
  onSelect: (bindingId: string) => void;
  onLeave: (bindingId: string) => void;
  /** The focused worktree's own strip, drawn after its chip. */
  children: React.ReactNode;
}

/** A chip's text: the branch, or what a checkout with no branch is called. */
export function heroChipLabel(
  bindingId: string,
  worktrees: readonly Worktree[],
): string {
  const worktree = worktrees.find((w) => w.binding_id === bindingId);
  if (worktree === undefined) return bindingId;
  if (worktree.branch !== null && worktree.branch !== "") {
    return worktree.branch;
  }
  return worktree.role === "main" ? "main" : bindingId;
}

const CHIP_CLASS =
  "group flex h-[26px] max-w-[14rem] shrink-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function HeroStrip({
  children,
  onLeave,
  onSelect,
  order,
  selectedWorktreeId,
  tabCounts,
  worktrees,
}: HeroStripProps) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5"
      data-testid="hero-strip"
    >
      {order.map((bindingId) => {
        const focused = bindingId === selectedWorktreeId;
        const label = heroChipLabel(bindingId, worktrees);
        const count = tabCounts.get(bindingId) ?? 0;
        return (
          <React.Fragment key={bindingId}>
            <div
              className={`flex min-w-0 items-center gap-1 ${
                focused ? "" : "shrink-0"
              }`}
              data-focused={focused ? "true" : "false"}
              data-testid={`hero-chip-${bindingId}`}
            >
              <button
                aria-current={focused ? "true" : undefined}
                aria-label={
                  focused
                    ? `${label}, focused`
                    : `${label}, ${count} ${count === 1 ? "tab" : "tabs"}`
                }
                className={`${CHIP_CLASS} ${
                  focused
                    ? "bg-foreground/[.08] font-medium text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[.06] hover:text-foreground"
                }`}
                data-testid={`hero-chip-select-${bindingId}`}
                onClick={() => {
                  if (!focused) onSelect(bindingId);
                }}
                title={label}
                type="button"
              >
                <span className="truncate">{label}</span>
                {focused ? null : (
                  <span className="rounded bg-foreground/[.08] px-1 text-2xs tabular-nums">
                    {count}
                  </span>
                )}
              </button>
              <button
                aria-label={`Leave ${label}: close its shells`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100 [div:hover>&]:opacity-100"
                data-testid={`hero-chip-leave-${bindingId}`}
                onClick={() => onLeave(bindingId)}
                title="Leave this worktree — closes its shells"
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {focused ? children : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
