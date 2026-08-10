import markUrl from "./mark.png";
import "./vingilot-mark.css";

/**
 * Intrinsic pixel size of `mark.png`, produced by `vingilot/brand/derive-mark.py`.
 *
 * The element is an empty `<span>` with no content to size it, so the aspect
 * ratio has to be declared rather than inferred. `vingilotMark.test.mjs` reads
 * the PNG's IHDR and fails if these drift from the committed asset — re-running
 * the derivation with different geometry must not silently squash the mark.
 */
export const MARK_INTRINSIC_WIDTH = 351;
export const MARK_INTRINSIC_HEIGHT = 384;

/**
 * The Vingilot mark: the owner's artwork as a CSS mask over `currentColor`.
 *
 * Deliberately a sibling of upstream's `shared/ui/buzz-logo/BuzzMark`, not a
 * replacement for it. Upstream's bee is still upstream's to draw wherever
 * upstream surfaces render it; this is the fork's own product mark, and the two
 * coexist. Both tint from `currentColor`, so a caller sets the colour the same
 * way for either.
 *
 * Sizing follows the same contract as `BuzzMark`: give it one dimension and let
 * the aspect ratio supply the other (`h-11 w-auto`, `w-full h-auto`). Note the
 * mark is *portrait* where the bee is landscape, so a call site swapped over
 * from `BuzzMark` at a fixed width gets a taller box than it had.
 *
 * Always `aria-hidden`, like `BuzzMark`. Every surface that shows the mark
 * already names itself in text — the loading gates carry an `sr-only` caption —
 * so announcing it again would be a duplicate, not an addition.
 */
export function VingilotMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={["vingilot-mark", className].filter(Boolean).join(" ")}
      style={{
        aspectRatio: `${MARK_INTRINSIC_WIDTH} / ${MARK_INTRINSIC_HEIGHT}`,
        WebkitMaskImage: `url(${markUrl})`,
        maskImage: `url(${markUrl})`,
      }}
    />
  );
}
