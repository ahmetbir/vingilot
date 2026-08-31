// A unified patch, re-shaped into rows a reader can look at rather than lines
// git can transmit (redesign P4.4).
//
// > *"diff ui'i artik guzel olsun bi tik yaaa hala cok terminal gibi"*
//
// His screenshot was `git diff`'s stdout pasted into a pane: the `diff --git`
// line, the `index 4dc47…` line, `---`/`+++`, `@@` headers, and every changed
// line shifted one character to the right by its own `+`/`-` prefix. All of
// that is git's WIRE FORMAT. It is how a patch travels between two programs,
// and it is not information — the file row above the patch already says which
// file this is, and the sign of a line is something a colour and a column can
// say without moving the code.
//
// So this module answers, for a patch: what are its hunks, what are its lines,
// what number does each line have in each side's file, and what did git say
// that is worth reading. What is left over is dropped, and what is left over
// that this module does not RECOGNISE is kept as a note — a `Binary files …
// differ`, a `\ No newline at end of file`, the backend's own truncation
// marker. Silently swallowing a line git chose to print would be this module
// deciding the owner does not need to know something.
//
// **What is NOT here.** How a patch line is classified is still
// `lib/runModel.ts`'s `diffView` — the same function the split layout reads,
// so the two cannot disagree about what a `+` is. How the rows are drawn,
// which language they are highlighted as and where they wrap are
// `ui/PatchView.tsx`'s. This file is arithmetic and a vocabulary; it renders
// nothing.
//
// **The numbering rule is `splitDiff.ts`'s, deliberately shared in spirit and
// not in code**: a number is only ever counted from a hunk header that was
// read, never guessed, and a line before the first header is preamble rather
// than a line of anybody's file.

import { diffView } from "@/features/runs/lib/runModel";

/** One row of the unified rendering. */
export type DiffRow =
  | {
      /** A hunk header, drawn as the mockup's quiet `.hunk` strip. */
      kind: "hunk";
      /** `@@ -41,9 +41,11 @@` — git's own ranges, kept because a reader who
       * wants them wants them exactly. */
      range: string;
      /** What git put AFTER the ranges: the enclosing function, when git could
       * work one out. **This is the human half of the header** and the reason
       * the strip survives at all — "func testCheckoutCompletes()" says where
       * in the file you are in a way two pairs of numbers never will. Empty
       * when git offered none, and then the strip carries the ranges alone. */
      context: string;
    }
  | {
      /** Something git printed that is neither plumbing nor a line of either
       * file: `\ No newline at end of file`, `Binary files … differ`, the
       * backend's truncation marker, or any preamble line this module does not
       * recognise. Kept rather than dropped — see the header. */
      kind: "note";
      text: string;
    }
  | {
      kind: "line";
      /** `" "`, `"+"` or `"-"`. Drawn in a column of its own, never as the
       * first character of the code. */
      sign: " " | "+" | "-";
      /** This line's number in the old file, or `null` when it is not in it
       * (an addition) or when no hunk header has been read. */
      before: number | null;
      /** …and in the new file. */
      after: number | null;
      /** The code, with the marker column already taken off. */
      text: string;
    };

/** `@@ -12,7 +30,9 @@`, and the forms with a count left off (`@@ -1 +1 @@`),
 * which git emits for a one-line range. */
const HUNK = /^(@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@)(.*)$/;

/** git's wire format, line for line.
 *
 * **Matched only in a patch's preamble**, which is what makes this exact
 * rather than nearly exact: inside a hunk every line carries a marker column,
 * so a context line reading `index abc` arrives as `" index abc"` and cannot
 * match any of these. `diffView` classifies `---`/`+++` as `meta` before this
 * list is consulted; the rest arrive as context and are matched here. */
const PLUMBING = [
  "diff --git ",
  "index ",
  "old mode ",
  "new mode ",
  "new file mode ",
  "deleted file mode ",
  "similarity index ",
  "dissimilarity index ",
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
] as const;

/** Is this line git's wire format rather than anybody's file?
 *
 * Exported since P4.6 because the SPLIT layout needs the same answer. Until
 * then only `unifiedRows` asked, and split drew `diff --git`, `index` and
 * `---`/`+++` verbatim — P4.4's own defect, surviving in the layout that round
 * did not rewrite, and visible the moment the diff tab put split on the stage.
 * One list, two readers. */
export function isPlumbing(text: string): boolean {
  return PLUMBING.some((prefix) => text.startsWith(prefix));
}

/** A hunk header split into the ranges and git's enclosing-symbol hint, or
 * `null` for a header shape this build cannot read — which is drawn whole
 * rather than dropped, exactly as `unifiedRows` does with one. */
export function hunkParts(
  text: string,
): { range: string; context: string } | null {
  const found = HUNK.exec(text);
  if (found === null) return null;
  return { context: found[4].trim(), range: found[1] };
}

/** The line without its marker column, and only when the marker is really
 * there. `splitDiff.ts`'s own rule and its reason: a patch whose context lines
 * have had their leading space trimmed by some tool in the middle is a patch
 * whose first character is code, and eating it would be this model quietly
 * deleting source. */
function body(text: string, marker: string): string {
  return text.startsWith(marker) ? text.slice(marker.length) : text;
}

/** The rows of the unified rendering of `patch`.
 *
 * Pure, total, and never throws: a patch this model cannot make sense of comes
 * back as note rows, which draw as the lines they are. */
export function unifiedRows(patch: string): DiffRow[] {
  const lines = diffView(patch).lines;
  const rows: DiffRow[] = [];
  let before: number | null = null;
  let after: number | null = null;

  const last = lines.length - 1;
  lines.forEach((line, at) => {
    switch (line.kind) {
      case "hunk": {
        const found = HUNK.exec(line.text);
        if (found === null) {
          // A header shape this build cannot read leaves the numbering unknown
          // rather than wrong, and the header itself is still shown.
          before = null;
          after = null;
          rows.push({ context: "", kind: "hunk", range: line.text });
          return;
        }
        before = Number(found[2]);
        after = Number(found[3]);
        rows.push({
          context: found[4].trim(),
          kind: "hunk",
          range: found[1],
        });
        return;
      }
      case "meta":
        // `---`/`+++` are the file's own names in git's wire format and the
        // file row above already carries the path; the backend's truncation
        // marker is not, and is kept.
        if (line.text.startsWith("---") || line.text.startsWith("+++")) return;
        rows.push({ kind: "note", text: line.text });
        return;
      case "add":
        rows.push({
          after,
          before: null,
          kind: "line",
          sign: "+",
          text: body(line.text, "+"),
        });
        if (after !== null) after += 1;
        return;
      case "del":
        rows.push({
          after: null,
          before,
          kind: "line",
          sign: "-",
          text: body(line.text, "-"),
        });
        if (before !== null) before += 1;
        return;
      case "ctx": {
        // A second file's preamble inside one patch string. Nothing in this
        // app concatenates patches today — `commit_diff` answers one per file
        // — but a reader that numbered the second file's lines from the
        // first's counters would be wrong in a way nobody could see.
        if (line.text.startsWith("diff --git ")) {
          before = null;
          after = null;
          return;
        }
        // `\ No newline at end of file` is a note about the line above, not a
        // line of either file. It advances no counter.
        if (line.text.startsWith("\\")) {
          rows.push({ kind: "note", text: line.text });
          return;
        }
        if (before === null && after === null) {
          if (line.text === "" || isPlumbing(line.text)) return;
          rows.push({ kind: "note", text: line.text });
          return;
        }
        // A patch that ends in a newline splits into a trailing empty string,
        // which has no marker to say otherwise. It is not a line of anybody's
        // file: numbering it would put a phantom line at the end of every
        // diff.
        if (line.text === "" && at === last) return;
        rows.push({
          after,
          before,
          kind: "line",
          sign: " ",
          text: body(line.text, " "),
        });
        if (before !== null) before += 1;
        if (after !== null) after += 1;
        return;
      }
    }
  });

  return rows;
}

/** The code of every `line` row, in order, as one string.
 *
 * **What the highlighter is handed.** Shiki tokenises a text and answers one
 * token list per line, so the rows and the token lists line up by counting
 * only the rows that ARE lines — `codeText` and `unifiedRows` walk the same
 * array in the same order, which is what makes `tokensFor` below an index
 * rather than a lookup.
 *
 * The old and new lines interleave, so this is not a syntactically valid file
 * and a multi-line construct can confuse a TextMate grammar across a change
 * block. That is the same trade every diff viewer makes (GitHub's included),
 * and it is worth stating: the colours are a reading aid over a patch, not a
 * parse of either file. */
export function codeText(rows: readonly DiffRow[]): string {
  const out: string[] = [];
  for (const row of rows) if (row.kind === "line") out.push(row.text);
  return out.join("\n");
}
