// The drawings behind `lib/fileIcons.ts` — twenty inline glyphs, one per
// language family, in the Seti register VS Code ships: a single silhouette
// per type, tinted, at 14px, the size the mockup's own `.fico` is.
//
// **Why inline and not a package** is argued in `fileIcons.ts`'s header. What
// belongs here is the drawing rule the glyphs keep, so the set stays one set:
//
// - **One 24×24 box, `currentColor` only.** Every path is monochrome and takes
//   its colour from the row, so a tint is a class on the wrapper and a theme
//   change needs no edit here. Nothing knocks a hole through to the ground —
//   a two-tone mark would be wrong on the dock's card, the float's popover and
//   the tab strip's terminal ground, which are three different colours.
// - **Silhouette over letterform.** The owner's complaint about the mockup was
//   that every file wore the same lettered chip, so a set that answered with
//   twenty letters would have missed the point. The two exceptions are the
//   marks that ARE letterforms in the world — TypeScript's and JavaScript's
//   brand squares — and even those are told apart by their frame before their
//   letters.
// - **Optical weight, not geometric.** Strokes are 2 units in a 24 box (the
//   weight `lucide-react` uses everywhere else in this app) so the icons sit
//   at the same darkness as the chevrons beside them.

import type * as React from "react";

import type { FileIconId } from "@/features/runs/lib/fileIcons";
import { FILE_ICON_TINT, FILE_ICON_TITLE } from "@/features/runs/lib/fileIcons";

/** The paths, keyed by glyph. Split out of the component so the set can be
 * read as a table rather than as a twenty-arm switch. */
const GLYPHS: Readonly<Record<FileIconId, React.ReactNode>> = {
  // A stylesheet's shield, the CSS3 mark's outline.
  css: (
    <>
      <path
        d="M5 3h14l-1.3 15L12 20l-5.7-2L5 3Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M9 8h6M9 12h6l-.4 3.2-2.6.9-2.6-.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  // The plain document — the fallback, and deliberately the quietest shape in
  // the set so a tree of unknown types does not look like a tree of alarms.
  file: (
    <path
      d="M6 3h7l5 5v13H6V3Zm7 0v5h5"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  // The mockup's own `.fico` path (Vingilot.html:247), traced exactly — the
  // owner's licence covers the file types, not the folder.
  folder: (
    <path
      d="M4 20V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
      fill="currentColor"
    />
  ),
  // The gopher, reduced to what survives at 14px: ears, head, two eyes.
  go: (
    <>
      <path
        d="M7 6.5V5m10 1.5V5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <rect
        fill="none"
        height="13"
        rx="5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        width="14"
        x="5"
        y="6"
      />
      <circle cx="9.6" cy="11.5" fill="currentColor" r="1.4" />
      <circle cx="14.4" cy="11.5" fill="currentColor" r="1.4" />
    </>
  ),
  // Markup: the angle brackets every editor draws it with.
  html: (
    <path
      d="m8 8-5 4 5 4m8-8 5 4-5 4m-2-11-4 14"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  image: (
    <>
      <rect
        fill="none"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width="18"
        x="3"
        y="4"
      />
      <circle cx="8.5" cy="9.5" fill="currentColor" r="1.5" />
      <path
        d="m4 17 5-5 4 4 3-2 4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  // JavaScript's brand square: the frame first, the letters second.
  js: (
    <>
      <rect
        fill="none"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        width="18"
        x="3"
        y="3"
      />
      <path
        d="M10.5 8v6a1.6 1.6 0 0 1-3.2 0M17 8.6a2 2 0 0 0-3.3 1.5c0 2.2 3.3 1.5 3.3 3.6a2 2 0 0 1-3.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>
  ),
  json: (
    <path
      d="M9 3a3 3 0 0 0-3 3v3a3 3 0 0 1-3 3 3 3 0 0 1 3 3v3a3 3 0 0 0 3 3m6-18a3 3 0 0 1 3 3v3a3 3 0 0 0 3 3 3 3 0 0 0-3 3v3a3 3 0 0 1-3 3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  ),
  lock: (
    <>
      <rect
        fill="none"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width="14"
        x="5"
        y="11"
      />
      <path
        d="M8 11V7.5a4 4 0 0 1 8 0V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </>
  ),
  // The CommonMark mark: the rounded frame with its M and its arrow.
  markdown: (
    <>
      <rect
        fill="none"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width="20"
        x="2"
        y="5"
      />
      <path
        d="M5.5 15V9l2.5 3 2.5-3v6m5-6v4.6m0 0L13.5 12m1.5 1.6L16.5 12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  // Python's two interlocking bodies, at the scale that still reads as two.
  python: (
    <path
      d="M12 3c-3 0-4.5.8-4.5 2.6V8H12v1H6.2C4.4 9 3 10.3 3 13s1.4 4 3.2 4H8v-2.6C8 12.6 9.4 11 11.4 11h4.4c1.6 0 2.7-1.2 2.7-2.7V5.6C18.5 3.9 16 3 12 3Zm-2.4 1.9a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8ZM12 21c3 0 4.5-.8 4.5-2.6V16H12v-1h5.8c1.8 0 3.2-1.3 3.2-4s-1.4-4-3.2-4H16v2.6c0 1.8-1.4 3.4-3.4 3.4H8.2c-1.6 0-2.7 1.2-2.7 2.7v3.7C5.5 20.1 8 21 12 21Zm2.4-1.9a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"
      fill="currentColor"
    />
  ),
  // React's atom — the mark VS Code gives .tsx and .jsx, tinted by which of
  // the two it is.
  react: (
    <>
      <circle cx="12" cy="12" fill="currentColor" r="2" />
      <ellipse
        cx="12"
        cy="12"
        fill="none"
        rx="10"
        ry="4.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <ellipse
        cx="12"
        cy="12"
        fill="none"
        rx="10"
        ry="4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        transform="rotate(60 12 12)"
      />
      <ellipse
        cx="12"
        cy="12"
        fill="none"
        rx="10"
        ry="4.2"
        stroke="currentColor"
        strokeWidth="1.6"
        transform="rotate(120 12 12)"
      />
    </>
  ),
  // Rust's gear, with the hub the cargo mark keeps.
  rust: (
    <>
      <path
        d="M12 2.6 14 5l3-1.2 1 3.2 3.3.5-1 3.1 2.2 2.5-2.6 2 .8 3.2-3.3.2-1.4 3-2.9-1.5-2.9 1.5-1.4-3-3.3-.2.8-3.2-2.6-2L2.7 10.6l-1-3.1L5 7 6 3.8 9 5l2-2.4Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="3.4"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </>
  ),
  // A shell script is a prompt: the chevron and the cursor rule.
  shell: (
    <>
      <rect
        fill="none"
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width="18"
        x="3"
        y="4"
      />
      <path
        d="m7 9 3 3-3 3m5.5 0H17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>
  ),
  sql: (
    <>
      <ellipse
        cx="12"
        cy="6"
        fill="none"
        rx="7"
        ry="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </>
  ),
  // Swift's bird, as the swoosh and the tail that survive at this size.
  swift: (
    <path
      d="M4.2 4.4c4 3.5 7.5 6 10.4 7.6-1.6-2.3-3-4.6-4.2-7 3.3 3.4 6.6 5.9 9.9 7.4.5-2.6.1-5.4-1.2-8.4 2.6 4 3.4 8 2.4 11.9.9 1.5 1.2 3 .8 4.5-.9-1.5-2.1-2.4-3.6-2.7-2.7 1.4-6 1.4-9.8-.2-1.6-.7-3-1.7-4.2-3 2.5 1.3 5.2 1.8 8.2 1.4C9.9 12.8 6.9 9.1 4.2 4.4Z"
      fill="currentColor"
    />
  ),
  text: (
    <>
      <path
        d="M6 3h7l5 5v13H6V3Zm7 0v5h5"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M9 12h6M9 16h6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>
  ),
  // Configuration: the sliders every settings surface in this app draws.
  toml: (
    <path
      d="M5 6h14M5 12h14M5 18h14M9 4v4m6 2v4m-6 2v4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    />
  ),
  // TypeScript's brand square.
  ts: (
    <>
      <rect
        fill="none"
        height="18"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        width="18"
        x="3"
        y="3"
      />
      <path
        d="M6.5 9h5M9 9v7m8-6.6a2 2 0 0 0-3.4 1.4c0 2.2 3.4 1.5 3.4 3.6a2 2 0 0 1-3.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>
  ),
  // YAML: the indented key list it is, which is also what tells it apart from
  // TOML's sliders at a glance.
  yaml: (
    <path
      d="M4 6h4m3 0h9M8 12h4m3 0h5M4 18h4m3 0h9"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    />
  ),
};

/** One 14px glyph, tinted, decorative.
 *
 * `aria-hidden` on purpose: every row that draws one also prints the file's
 * name, so the icon repeats nothing a screen reader needs. The `title` is for
 * the pointer, which has no other way to learn the vocabulary. */
export function FileIcon({ id }: { id: FileIconId }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center ${FILE_ICON_TINT[id]}`}
      data-file-icon={id}
      title={FILE_ICON_TITLE[id]}
    >
      {/* `aria-hidden` on the drawing as well as on its wrapper: the name is
       * printed beside it in every row that draws one, so the glyph repeats
       * nothing and should not be announced twice. */}
      <svg aria-hidden="true" height="14" viewBox="0 0 24 24" width="14">
        {GLYPHS[id]}
      </svg>
    </span>
  );
}
