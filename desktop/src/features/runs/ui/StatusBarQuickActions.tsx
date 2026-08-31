// The mockup's quick-action row (`.sbtn`: Stop / Review / Commit / Create
// PR, Vingilot.html:333) — the owner's own feature, verbatim: "these can be
// ready-made prompts, configurable in Settings, that type into tmux and
// press Enter automatically. Except Review."
//
// Two declared exceptions, in the mockup's own order:
// - **Stop** keeps the app's existing real stop-run behavior
//   (`StopAllButton` — hold 600ms to pause every live run in the workspace)
//   rather than becoming a canned prompt. A typed "please stop" is not a
//   stop: nothing reads it as one, and `StopAllButton` already does the real
//   thing this button would only be claiming to. It keeps its own
//   hold-to-engage shape (rounded-full, uppercase, destructive colors)
//   rather than the mockup's plain `.sbtn` pill — that shape IS the safety
//   affordance ("this one needs a hold, not a click"), and reskinning it
//   away would delete the thing that makes an accidental workspace-wide stop
//   hard to trigger. A conscious deviation from `.sbtn` fidelity, declared.
// - **Review** opens the popover (`StatusBarReviewPopover.tsx`) rather than
//   typing anything — the standing order's declared exception, enforced by
//   construction: this button is a `PopoverTrigger`, never wired to
//   `onQuickAction`.
//
// Everything else is `quickActions.ts`'s configurable buttons: editable in
// Settings (`VingilotQuickActionsSettings.tsx`), pressed here, typed into the
// ACTIVE terminal session by the caller (`onQuickAction`, backed by
// `useActiveTerminalTyping.ts`'s `ptyWrite`) — visible in the shell, never
// hidden. Disabled while there is no active session to type into: a button
// that types nowhere would be the "fact is not a click" rule broken the
// other way.

import * as React from "react";

import {
  renderQuickActionPrompt,
  type QuickActionButton,
  type QuickActionVars,
} from "@/features/runs/lib/quickActions";
import type { ReviewDispatch } from "@/features/runs/lib/useReviewDispatch";
import { StatusBarReviewPopover } from "@/features/runs/ui/StatusBarReviewPopover";
import { StopAllButton } from "@/features/runs/ui/StopAllButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

const SBTN =
  "rounded-md bg-foreground/[.07] px-3 py-1 text-2xs font-semibold text-foreground/80 transition-colors hover:bg-foreground/[.12] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/** The mockup's `.sbtn.pri` (vingilot.css: `background:var(--ink);
 * color:#1a1a1a`) — the row's one filled button. The mockup marks Create PR,
 * the last action in the row and the only one that publishes anything; here
 * the LAST configured button wears it, so a renamed or reordered row keeps
 * exactly one primary instead of hard-coding an id the owner can delete. */
const SBTN_PRIMARY =
  "rounded-md bg-foreground px-3 py-1 text-2xs font-semibold text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

export function StatusBarQuickActions({
  buttons,
  canType,
  onEngageStop,
  onQuickAction,
  onReleaseStop,
  review,
  stopEngaged,
  vars,
}: {
  buttons: readonly QuickActionButton[];
  /** Whether an active terminal session exists to type into. A configurable
   * button is a real door only while one does — `false` disables the row
   * rather than typing nowhere. */
  canType: boolean;
  onEngageStop: () => void;
  onQuickAction: (text: string) => void;
  onReleaseStop: () => void;
  review: ReviewDispatch;
  stopEngaged: boolean;
  vars: QuickActionVars;
}) {
  const [reviewOpen, setReviewOpen] = React.useState(false);

  return (
    <span className="ml-1.5 flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <StopAllButton
        engaged={stopEngaged}
        onEngage={onEngageStop}
        onRelease={onReleaseStop}
      />
      <Popover onOpenChange={setReviewOpen} open={reviewOpen}>
        <PopoverTrigger asChild>
          <button
            className={SBTN}
            data-testid="statusbar-quick-action-review"
            type="button"
          >
            Review
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px]" side="top">
          <StatusBarReviewPopover
            onStarted={() => setReviewOpen(false)}
            review={review}
          />
        </PopoverContent>
      </Popover>
      {buttons.map((button, index) => (
        <button
          className={index === buttons.length - 1 ? SBTN_PRIMARY : SBTN}
          data-primary={index === buttons.length - 1 ? true : undefined}
          data-testid={`statusbar-quick-action-${button.id}`}
          disabled={!canType}
          key={button.id}
          onClick={() =>
            onQuickAction(renderQuickActionPrompt(button.promptTemplate, vars))
          }
          title={
            canType
              ? button.promptTemplate
              : "no active terminal session to type into"
          }
          type="button"
        >
          {button.label}
        </button>
      ))}
    </span>
  );
}
