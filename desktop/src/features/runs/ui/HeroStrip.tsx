// The one tab strip, with every open worktree standing on it (2026-09-03).
//
// > *"Worktree değistirince hero terminalin değişmesi yoruyor. Diyorum ki
// > acaba bi sekilde terminali sabit tutup worktreeye basınca o worktree icin
// > o isimli tab mi eklese sadece?"*
//
// And his first report through the feedback drop, the same evening, on the
// first cut of this: *"1.si kaydiramiyorum. 2. isimlendirmeler igrenc ... tab
// group gibi bir gruba basinca o grup buyusun diger gruplar grup haline
// kuculsun? grup isimleri de repo/worktree gibi olabilir ... cok uzun ise
// ustune gelince kayabilir yazi."* Three things, all here now.
//
// **What it draws.** One chip per worktree that has tabs open, in the hero
// order (`heroOrder.ts`). The focused worktree's chip is expanded: its own
// `TerminalTabStrip` follows the chip. Every other chip is collapsed to its
// name and tab count. Pressing a collapsed chip focuses that worktree where
// it stands.
//
// **Names are `repo/worktree`** (`heroLabel.ts`), read off the checkout's
// directory — never the binding id, which is what the first cut showed him.
//
// **The strip scrolls.** Eight worktrees do not fit in a header, and the
// first cut clipped them. The row is one horizontal scroller with the
// scrollbar hidden; a wheel over it moves it sideways, and the focused chip
// is brought into view whenever focus moves.
//
// **A long name slides on hover.** The chip keeps its width; when the pointer
// rests on it the text glides left by exactly its overflow and back on leave,
// so the whole name is read without the strip reflowing.
//
// **Leaving is the chip's ×**: `closeWorktrees`, the act the nav's remove
// performs, reached from the strip; focus moves to the neighbour.
//
// **Tasks stay per-worktree.** A task is the shells of one checkout; a strip
// that spans checkouts does not change what a task is.

import { X } from "lucide-react";
import * as React from "react";

import { heroChipLabel } from "@/features/runs/lib/heroLabel";
import type { Worktree } from "@/features/runs/lib/projects";
import type { TerminalSession } from "@/features/runs/lib/terminalSessions";

export interface HeroStripProps {
  /** Open worktrees in strip order — `heroOrder.ts`'s reconciled list. */
  order: readonly string[];
  selectedWorktreeId: string | null;
  /** Every open session: the counts and the cwd each chip is named from. */
  terminals: readonly TerminalSession[];
  /** The coordinator's rows, for the branch of a checkout it provisioned. */
  worktrees: readonly Worktree[];
  onSelect: (bindingId: string) => void;
  onLeave: (bindingId: string) => void;
  /** The focused worktree's own strip, drawn after its chip. */
  children: React.ReactNode;
}

const CHIP_CLASS =
  "flex h-[26px] max-w-[12rem] shrink-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/** Glide the label left by its overflow while hovered — the measurement is
 * taken on enter, so a name that fits does nothing at all. */
function slideOnHover(event: React.MouseEvent<HTMLElement>) {
  const label = event.currentTarget.querySelector<HTMLElement>("[data-label]");
  if (label === null) return;
  const overflow = label.scrollWidth - label.clientWidth;
  if (overflow <= 0) return;
  label.style.transition = `transform ${Math.max(600, overflow * 24)}ms linear`;
  label.style.transform = `translateX(-${overflow}px)`;
}
function slideBack(event: React.MouseEvent<HTMLElement>) {
  const label = event.currentTarget.querySelector<HTMLElement>("[data-label]");
  if (label === null) return;
  label.style.transition = "transform 300ms ease-out";
  label.style.transform = "";
}

export function HeroStrip({
  children,
  onLeave,
  onSelect,
  order,
  selectedWorktreeId,
  terminals,
  worktrees,
}: HeroStripProps) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);

  const { counts, cwds } = React.useMemo(() => {
    const counts = new Map<string, number>();
    const cwds = new Map<string, string>();
    for (const t of terminals) {
      counts.set(t.bindingId, (counts.get(t.bindingId) ?? 0) + 1);
      if (t.cwd !== null && !cwds.has(t.bindingId))
        cwds.set(t.bindingId, t.cwd);
    }
    return { counts, cwds };
  }, [terminals]);

  // The focused chip stays in view: on every change of focus, and once the
  // order settles after a mount, scroll it into the row.
  React.useEffect(() => {
    if (selectedWorktreeId === null) return;
    const chip = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-testid="hero-chip-${CSS.escape(selectedWorktreeId)}"]`,
    );
    chip?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedWorktreeId]);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
      data-testid="hero-strip"
      onWheel={(event) => {
        // A vertical wheel is the gesture he has; the row is what moves.
        const el = event.currentTarget;
        if (el.scrollWidth <= el.clientWidth) return;
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          el.scrollLeft += event.deltaY;
          event.preventDefault();
        }
      }}
      ref={scrollerRef}
    >
      {order.map((bindingId) => {
        const focused = bindingId === selectedWorktreeId;
        const label = heroChipLabel(
          bindingId,
          cwds.get(bindingId) ?? null,
          worktrees.find((w) => w.binding_id === bindingId)?.branch ?? null,
        );
        const count = counts.get(bindingId) ?? 0;
        return (
          <React.Fragment key={bindingId}>
            <div
              className="group flex shrink-0 items-center gap-0.5"
              data-focused={focused ? "true" : "false"}
              data-testid={`hero-chip-${bindingId}`}
              onMouseEnter={slideOnHover}
              onMouseLeave={slideBack}
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
                <span
                  className="inline-block whitespace-nowrap will-change-transform"
                  data-label
                >
                  {label}
                </span>
                {focused ? null : (
                  <span className="shrink-0 rounded bg-foreground/[.08] px-1 text-2xs tabular-nums">
                    {count}
                  </span>
                )}
              </button>
              <button
                aria-label={`Leave ${label}: close its shells`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100"
                data-testid={`hero-chip-leave-${bindingId}`}
                onClick={() => onLeave(bindingId)}
                title="Leave this worktree — closes its shells"
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            {focused ? (
              <div className="flex shrink-0 items-center">{children}</div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
