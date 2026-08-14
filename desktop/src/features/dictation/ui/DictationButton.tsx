// The mic control and its "listening…" indicator — one visual vocabulary
// shared by the message composer and the Ask box, the two fold targets
// (vingilot/docs/plans/2026-08-13-voice.md, Task 3).
//
// On-device only: this component only ever calls into `useDictation`, which
// is the whole story on where audio and text go (see that hook's header).

import { Loader2, Mic } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { Dictation } from "@/features/dictation/lib/useDictation";

/** The mic toggle. Pressing it while idle starts a session (prompting for a
 * model download first if one is needed); pressing it while listening stops.
 * Disabled, not hidden, while a model download is in flight — the tooltip
 * still says why, so the control never just vanishes on the owner. */
export function DictationButton({
  dictation,
  disabled = false,
}: {
  dictation: Dictation;
  disabled?: boolean;
}) {
  const listening = dictation.status === "listening";
  const downloading = dictation.status === "downloading-model";
  const label = listening
    ? "Stop dictation"
    : downloading
      ? "Downloading speech model…"
      : "Dictate";
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={listening}
          data-dictation-status={dictation.status}
          data-testid="dictation-mic-button"
          disabled={disabled || downloading}
          onClick={() => (listening ? dictation.stop() : dictation.start())}
          size="icon"
          type="button"
          variant={listening ? "default" : "ghost"}
        >
          {downloading ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Mic
              aria-hidden="true"
              className={cn(
                "h-4 w-4",
                listening && "text-destructive-foreground",
              )}
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The unmistakable capture-state readout: a pulsing dot + "listening…"
 * while a session is live, or the download/error sentence otherwise. Placed
 * by the caller wherever it reads best on that surface — this component only
 * draws the row, it doesn't position itself. */
export function DictationStatusRow({ dictation }: { dictation: Dictation }) {
  if (dictation.status === "listening") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        data-testid="dictation-listening-indicator"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-destructive"
        />
        listening…
      </span>
    );
  }
  if (dictation.status === "downloading-model") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        data-testid="dictation-downloading-indicator"
      >
        <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        downloading speech model…
      </span>
    );
  }
  if (dictation.status === "error" && dictation.error) {
    return (
      <span
        className="text-xs text-destructive"
        data-testid="dictation-error"
        role="alert"
      >
        {dictation.error}
      </span>
    );
  }
  return null;
}
