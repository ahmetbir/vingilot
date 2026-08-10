import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/shared/lib/cn";
import { VingilotMark } from "@/features/vingilot-brand/VingilotMark";
import { useTranscriptAnimationEnabled } from "./transcriptAnimationPreference";

const MARKS = ["first", "second", "third"] as const;
const STAGGER_SECONDS = 0.25;
const CYCLE_SECONDS = 1.8;

/**
 * Three marks rising and fading in sequence while an agent's turn runs.
 *
 * The marks are static. Upstream drew each one with the animated FuzzyLogo, so
 * every mark was playing its own morph inside a row that was already animating
 * the row — and at this size that is the wrong place to spend it. The Vingilot
 * mark is a sailing ship, and a ship at 20px reads as a silhouette whichever
 * frame it is on: the sails do not separate below roughly 32px, measured when
 * the menu-bar template image was sized. What carries "something is happening"
 * here is the stagger, and the stagger is untouched.
 *
 * The `fuzz` prop is gone with the animation it selected; no caller passed it.
 */
export function TurnLivenessIndicator({ className }: { className?: string }) {
  const animationsEnabled = useTranscriptAnimationEnabled();
  const shouldReduceMotion = useReducedMotion();
  const showStaggeredRow = animationsEnabled && !shouldReduceMotion;

  if (!showStaggeredRow) {
    return (
      <div
        aria-label="Agent turn in progress"
        className={cn("opacity-25", className)}
        data-testid="turn-liveness-indicator"
        role="status"
      >
        <VingilotMark className="h-6 w-auto text-foreground" />
      </div>
    );
  }

  return (
    <div
      aria-label="Agent turn in progress"
      className={cn("flex items-center gap-1.5 opacity-25", className)}
      data-testid="turn-liveness-indicator"
      role="status"
    >
      {MARKS.map((mark, index) => (
        <motion.div
          animate={{
            opacity: [0, 1, 1, 0],
            y: [4, 0, -1, -4],
          }}
          key={mark}
          transition={{
            delay: index * STAGGER_SECONDS,
            duration: CYCLE_SECONDS,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            times: [0, 0.3, 0.7, 1],
          }}
        >
          <VingilotMark className="h-5 w-auto text-foreground" />
        </motion.div>
      ))}
    </div>
  );
}
