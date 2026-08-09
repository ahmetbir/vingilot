// Choosing what sits beside the terminal, from the pane's own header.
//
// **An unavailable pane stays in the list.** It is disabled and it carries its
// reason, because the two things the owner might be asking are "what can go
// here?" and "why can't Evidence go here?", and a picker that hides what it
// cannot offer answers neither. A pane that is merely waiting for an answer
// stays selectable — it will resolve, and refusing it would be reading a
// pending answer as a refusal.

import type { PaneAvailability, PaneId } from "@/features/runs/lib/paneModel";
import type { PaneEntry } from "@/features/runs/ui/paneRegistry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

interface PanePickerProps {
  current: PaneEntry;
  /** Every pane this side may show, with what each one can do here. */
  choices: Array<{ entry: PaneEntry; availability: PaneAvailability }>;
  onChoose: (pane: PaneId) => void;
}

/** The header label for a side that does not choose — the terminal's. It
 * carries the same glyph and weight as the picker's trigger so the two headers
 * read as one row rather than as two different kinds of chrome. */
export function PaneLabel({ entry }: { entry: PaneEntry }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 px-1 py-1 text-sm font-medium text-foreground"
      data-testid={`pane-label-${entry.id}`}
    >
      <span aria-hidden="true" className="text-muted-foreground">
        {entry.icon}
      </span>
      {entry.title}
    </span>
  );
}

function reasonOf(availability: PaneAvailability): string | null {
  if (availability.status === "unavailable") return availability.reason;
  if (availability.status === "pending") return availability.note;
  return null;
}

export function PanePicker({ choices, current, onChoose }: PanePickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`change the right pane — showing ${current.title}`}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
          data-testid="pane-picker"
          type="button"
        >
          <span aria-hidden="true" className="text-muted-foreground">
            {current.icon}
          </span>
          {current.title}
          <span aria-hidden="true" className="text-muted-foreground">
            ▾
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {choices.map(({ availability, entry }) => {
          const reason = reasonOf(availability);
          const blocked = availability.status === "unavailable";
          return (
            <DropdownMenuItem
              className="flex-col items-start gap-0.5"
              data-testid={`pane-choice-${entry.id}`}
              disabled={blocked}
              key={entry.id}
              onSelect={() => onChoose(entry.id)}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span aria-hidden="true" className="text-muted-foreground">
                  {entry.icon}
                </span>
                {entry.title}
                {entry.id === current.id ? (
                  <span aria-hidden="true" className="text-muted-foreground">
                    ✓
                  </span>
                ) : null}
              </span>
              {reason === null ? null : (
                <span className="whitespace-normal text-2xs text-muted-foreground">
                  {reason}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
