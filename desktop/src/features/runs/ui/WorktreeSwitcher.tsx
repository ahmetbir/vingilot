// The terminal's context header: which worktree this terminal is in, and a
// quick way to another (2026-09-03, his second report through the drop).
//
// > *"Worktree bir "tab" değil, terminalin çalıştığı bağlam olmalı ...
// > `ai / dev ▾` kısmına tıklanınca hızlı worktree seçici açılır."*
//
// **One label, one door.** The trigger reads `repo/worktree` — the name he
// uses for the checkout (`worktreeLabel.ts`) — and opens a list: **Recent**
// first (where he was just before, most recent first, the current one left
// out), then **this project's** worktrees in the order the nav shows them,
// which is also the ⌘1…9 order, so the digit is drawn beside each. A field
// at the top filters both by name. Choosing one is the same act as clicking
// the nav row: the hero terminal switches to that worktree's own sessions.
//
// Nothing here closes anything. A worktree is left by not being in it; its
// shells stay where they are (tmux), and ending them is the nav's remove.
//
// Deferred from his brief, on purpose and said so: pinned worktrees (there is
// no pin model for worktrees yet — the deck's pins are runs on the
// coordinator), attention marks in the list (the signals live a screen above
// this one, which sits at the file-size ratchet), and ⌥-click to split.

import { ChevronDown } from "lucide-react";
import * as React from "react";

import type { Worktree } from "@/features/runs/lib/projects";
import { recentToOffer } from "@/features/runs/lib/recentWorktrees";
import type { TerminalSession } from "@/features/runs/lib/terminalSessions";
import { worktreeLabel } from "@/features/runs/lib/worktreeLabel";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

export interface WorktreeSwitcherProps {
  selectedWorktreeId: string | null;
  /** Visited worktrees, most recent last (`recentWorktrees.ts`). */
  recent: readonly string[];
  /** This project's worktrees, in nav order — the ⌘1…9 order. */
  worktrees: readonly Worktree[];
  /** Every open session, for the cwd a label is read from. */
  terminals: readonly TerminalSession[];
  onSelect: (bindingId: string) => void;
}

function useLabels(
  worktrees: readonly Worktree[],
  terminals: readonly TerminalSession[],
) {
  return React.useCallback(
    (bindingId: string): string => {
      const cwd = terminals.find((t) => t.bindingId === bindingId)?.cwd ?? null;
      const branch =
        worktrees.find((w) => w.binding_id === bindingId)?.branch ?? null;
      return worktreeLabel(bindingId, cwd, branch);
    },
    [worktrees, terminals],
  );
}

const ROW_CLASS =
  "flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-foreground/[.06] focus-visible:outline-none focus-visible:bg-foreground/[.08] disabled:opacity-60";

export function WorktreeSwitcher({
  onSelect,
  recent,
  selectedWorktreeId,
  terminals,
  worktrees,
}: WorktreeSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const labelOf = useLabels(worktrees, terminals);

  const current =
    selectedWorktreeId === null ? "no worktree" : labelOf(selectedWorktreeId);
  const q = query.trim().toLowerCase();
  const matches = (id: string) =>
    q === "" || labelOf(id).toLowerCase().includes(q);
  const recentRows = recentToOffer(recent, selectedWorktreeId).filter(matches);
  const projectRows = worktrees
    .map((wt, index) => ({ id: wt.binding_id, index }))
    .filter(({ id }) => matches(id));

  const choose = (id: string) => {
    setOpen(false);
    setQuery("");
    onSelect(id);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={`Worktree: ${current}. Open the switcher`}
          className="flex min-w-0 max-w-[24rem] shrink items-center gap-1 rounded px-1 py-1 text-sm font-medium text-foreground hover:bg-foreground/[.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid="worktree-switcher"
          title={current}
          type="button"
        >
          <span className="truncate">{current}</span>
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-1.5"
        data-testid="worktree-switcher-list"
      >
        <Input
          aria-label="Filter worktrees"
          autoFocus
          className="mb-1.5 h-8"
          data-testid="worktree-switcher-filter"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const first = recentRows[0] ?? projectRows[0]?.id;
              if (first !== undefined) choose(first);
            }
          }}
          placeholder="Search worktrees…"
          value={query}
        />
        {recentRows.length === 0 ? null : (
          <div className="mb-1">
            <div className="px-2 pb-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
              Recent
            </div>
            {recentRows.map((id) => (
              <button
                className={ROW_CLASS}
                data-testid={`worktree-switcher-recent-${id}`}
                key={id}
                onClick={() => choose(id)}
                type="button"
              >
                <span className="truncate">{labelOf(id)}</span>
              </button>
            ))}
          </div>
        )}
        <div>
          <div className="px-2 pb-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
            This project
          </div>
          {projectRows.length === 0 ? (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              nothing matches
            </div>
          ) : (
            projectRows.map(({ id, index }) => (
              <button
                aria-current={id === selectedWorktreeId ? "true" : undefined}
                className={ROW_CLASS}
                data-testid={`worktree-switcher-row-${id}`}
                disabled={id === selectedWorktreeId}
                key={id}
                onClick={() => choose(id)}
                type="button"
              >
                <span className="truncate">{labelOf(id)}</span>
                <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                  {id === selectedWorktreeId
                    ? "open"
                    : index < 9
                      ? `⌘${index + 1}`
                      : ""}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
