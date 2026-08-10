import { useEffect, useState } from "react";

import posterUrl from "./mark-animation-poster.png?inline";
import sheetUrl from "./mark-animation.png";
import "./vingilot-mark-animation.css";

/**
 * The sprite sheet's geometry and cadence, produced by
 * `vingilot/brand/derive-animation.py`. `vingilotMarkAnimation.test.mjs` reads
 * the committed PNGs and fails if any of these drift from them — the frame
 * count in particular is arithmetic the CSS depends on, and a sheet that grew
 * a frame without this number growing with it would render every cell offset
 * by a fraction of itself rather than failing outright.
 */
export const SAIL_FRAMES = 28;
export const SAIL_CELL_WIDTH = 224;
export const SAIL_CELL_HEIGHT = 188;
export const SAIL_DURATION_MS = 2333;

/**
 * Whether the sprite sheet is decoded and ready to be painted as a mask.
 *
 * Deliberately `decode()` rather than `onload`: a loaded-but-undecoded mask
 * image is not a mask, and an element carrying a `currentColor` fill with no
 * mask yet resolved is a solid rectangle. Waiting for the decode is what keeps
 * the swap from the poster invisible.
 *
 * Every failure — a missing file, a corrupt sheet, a decode this webview will
 * not do — leaves this false, which leaves the poster on screen. That is the
 * whole contract: this can make the gate show a still mark, and cannot make it
 * show nothing.
 */
function useSailSheet(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    const settle = () => {
      if (live) {
        setReady(true);
      }
    };
    const image = new Image();
    // Only one of these two paths ever settles: with decode() available the
    // load event is too early to act on, and without it the load event is all
    // there is.
    image.onload = () => {
      if (typeof image.decode !== "function") {
        settle();
      }
    };
    image.src = sheetUrl;
    if (typeof image.decode === "function") {
      image.decode().then(settle, () => {});
    }
    return () => {
      live = false;
    };
  }, []);

  return ready;
}

/**
 * The Vingilot mark with the sails and the water moving — the owner's own clip,
 * keyed to alpha and consumed the same way the static {@link VingilotMark} is:
 * as a mask over `currentColor`, so a caller sets the colour by setting text
 * colour and both themes work from the one asset.
 *
 * **It never renders an empty box.** Before the sheet has decoded, and forever
 * if it never does, this draws the poster — cell 0 of the same sheet, at the
 * same crop, inlined into the JS bundle as a data URI so that it has no load to
 * fail. The two states are registered pixel for pixel, so the swap is the ship
 * beginning to move rather than one picture replacing another.
 *
 * Sizing follows {@link VingilotMark}: give it one dimension and the declared
 * aspect ratio supplies the other (`w-28`). The frame is landscape, wider than
 * the static mark is, because the crop is the union of every frame's extent and
 * the water travels sideways.
 *
 * Always `aria-hidden`: every surface that shows this already says what it is
 * waiting for in text.
 */
export function VingilotMarkAnimation({ className }: { className?: string }) {
  const sailing = useSailSheet();

  return (
    <span
      aria-hidden="true"
      className={["vingilot-mark-animation", className]
        .filter(Boolean)
        .join(" ")}
      data-state={sailing ? "sailing" : "poster"}
      data-testid="vingilot-mark-animation"
      style={{
        aspectRatio: `${SAIL_CELL_WIDTH} / ${SAIL_CELL_HEIGHT}`,
      }}
    >
      <span
        className="vingilot-mark-animation__ink"
        style={
          sailing
            ? ({
                WebkitMaskImage: `url(${sheetUrl})`,
                maskImage: `url(${sheetUrl})`,
                animationDuration: `${SAIL_DURATION_MS}ms`,
                animationTimingFunction: `steps(${SAIL_FRAMES}, jump-none)`,
                "--vingilot-sail-frames": SAIL_FRAMES,
              } as React.CSSProperties)
            : {
                WebkitMaskImage: `url(${posterUrl})`,
                maskImage: `url(${posterUrl})`,
              }
        }
      />
    </span>
  );
}
