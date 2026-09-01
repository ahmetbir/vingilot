// **The four pull-request glyphs, and the one colour each is allowed**
// (vingilot/design/mockup/Vingilot.html `#pr-list`, `vingilot.css` `.prico`).
//
// The mockup draws GitHub's own octicons at 16px and colours them
// `.pr-open #7ee787`, `.pr-merged #c6a0f6`, `.pr-draft rgba(255,255,255,.4)`.
// Those three hexes are a dark-only palette — the mockup has one theme and this
// app has two — so each is taken to its nearest token pair on the app's own
// ramp (emerald / violet / muted, with rose for a closed one, which the mockup
// never had to draw because it only ever listed open work).
//
// **The state decides the glyph, and `pullsCopy.stateLabel` decides the word.**
// They read the same two fields (`draft`, `state`) and must never disagree, so
// they are written to the same shape: draft first, then GitHub's spelling, then
// a state this build has not seen — which gets the open glyph in the muted
// colour rather than a guess dressed up as a merge.

import type { Pull } from "@/features/pulls/lib/pullsAnswer";

/** Octicon `git-pull-request`. */
const OPEN_PATH =
  "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z";

/** Octicon `git-pull-request-draft`. */
const DRAFT_PATH =
  "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1 1 0 0 1-1 1h-1.5a.75.75 0 0 1 0-1.5H13v-1a.75.75 0 0 1 1.5 0Z";

/** Octicon `git-merge`. */
const MERGED_PATH =
  "M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z";

/** Octicon `git-pull-request-closed`. */
const CLOSED_PATH =
  "M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.25 2.25 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-.47-4.53 1.28-1.28a.75.75 0 1 1 1.06 1.06l-1.28 1.28 1.28 1.28a.75.75 0 0 1-1.06 1.06l-1.28-1.28-1.28 1.28a.75.75 0 1 1-1.06-1.06l1.28-1.28-1.28-1.28a.75.75 0 0 1 1.06-1.06l1.28 1.28ZM3.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z";

interface Glyph {
  path: string;
  /** The mockup's `.pr-*` colour, on this app's two-theme ramp. */
  tone: string;
}

const OPEN: Glyph = {
  path: OPEN_PATH,
  tone: "text-emerald-600 dark:text-emerald-400",
};

/** Which glyph a pull request draws, from the two fields that carry its state. */
export function pullGlyph(pull: Pull): Glyph {
  if (pull.draft) {
    return { path: DRAFT_PATH, tone: "text-muted-foreground" };
  }
  switch (pull.state.toUpperCase()) {
    case "MERGED":
      return {
        path: MERGED_PATH,
        tone: "text-violet-600 dark:text-violet-400",
      };
    case "CLOSED":
      return { path: CLOSED_PATH, tone: "text-rose-600 dark:text-rose-400" };
    case "OPEN":
      return OPEN;
    default:
      // A state this build has never seen. `stateLabel` passes the word
      // through; this passes the shape through, in the colour that claims
      // nothing.
      return { path: OPEN_PATH, tone: "text-muted-foreground" };
  }
}

/** The row's and the detail's state glyph. Decorative: every place it is drawn
 * already says the state in words beside it. */
export function PullStateIcon({
  className,
  pull,
}: {
  className?: string;
  pull: Pull;
}) {
  const glyph = pullGlyph(pull);
  return (
    <svg
      aria-hidden="true"
      className={`${glyph.tone} ${className ?? "size-4"}`}
      data-pr-state={pull.draft ? "draft" : pull.state.toLowerCase()}
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path d={glyph.path} />
    </svg>
  );
}
