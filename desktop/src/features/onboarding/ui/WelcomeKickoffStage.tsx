import * as React from "react";

import {
  isWelcomeKickoffStageExiting,
  type WelcomeKickoffStagePhase,
} from "@/features/onboarding/useWelcomeKickoffStage";
import { cn } from "@/shared/lib/cn";

type StageCharacter = {
  name: string;
  animationUrl: string;
};

/**
 * Same animated APNGs the "Meet your starter team" onboarding step uses — one
 * entry per crew member that has character art.
 *
 * It is empty: the crew (Navigator, Bosun, Lookout, Scribe) replaced the bees
 * as the default team and has no art yet, and the bees' APNGs are not stand-ins
 * for it — a bee on the banner while a Bosun is being provisioned is the exact
 * mismatch the crew exists to remove. The stage keeps its wrapper so the exit
 * animation (and `onExitComplete`) behaves identically; it simply has nobody
 * standing on it until the art lands.
 */
const STAGE_CHARACTERS: readonly StageCharacter[] = [];

const STAGE_EXIT_ANIMATION = "motion-kickoff-stage-exit";

/**
 * The welcome team characters standing on top of the Welcome composer banner
 * while the team is being set up. Positioned relative to the banner wrapper
 * (`bottom-full` = feet on the banner's top edge) and purely decorative —
 * the banner's own copy carries the setup status for screen readers.
 *
 * Placeholder choreography: staggered rise-from-below entrance per character
 * (CSS `motion-kickoff-character-enter`, delay via `--stagger-index`), whole
 * row crossfades out on either resolution — the first agent message landing,
 * or the wait timing out. The characters must not linger after a timeout: a
 * stage that stays up implies a team is still coming when none is.
 */
export function WelcomeKickoffStage({
  onExitComplete,
  phase,
}: {
  onExitComplete: () => void;
  phase: WelcomeKickoffStagePhase;
}) {
  const handleAnimationEnd = React.useCallback(
    (event: React.AnimationEvent<HTMLDivElement>) => {
      if (event.animationName === STAGE_EXIT_ANIMATION) {
        onExitComplete();
      }
    },
    [onExitComplete],
  );

  if (phase === "hidden" || phase === "done") return null;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute bottom-full left-10 z-10 flex items-end gap-4",
        isWelcomeKickoffStageExiting(phase) && "motion-kickoff-stage-exit",
      )}
      data-phase={phase}
      data-testid="welcome-kickoff-stage"
      onAnimationEnd={handleAnimationEnd}
    >
      {STAGE_CHARACTERS.map((character, index) => (
        <img
          alt=""
          className="motion-kickoff-character-enter h-16 w-16 object-contain"
          data-testid={`welcome-kickoff-stage-${character.name.toLowerCase()}`}
          key={character.name}
          src={character.animationUrl}
          style={{ "--stagger-index": index } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
