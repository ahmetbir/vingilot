// Every chord this workspace binds, on one surface — **generated from the key
// modules themselves** (vingilot/docs/plans/2026-08-09-keys-and-type.md,
// Task 4).
//
// **Nothing here writes a chord down.** A hand-written list is a list that goes
// stale: the map moves, the sheet does not, and what the owner learns is that
// the sheet cannot be trusted — which is worse than no sheet, because the only
// way to find out is to press a key that does nothing. So every chord on the
// sheet is one the island's own `resolve*` functions really answer to, found by
// asking them: `resolvedChords` walks a bounded key space through every map and
// keeps what came back. Add a chord to `terminalKeys.ts` and it is on the
// sheet; take one away and it leaves.
//
// What is written down is the **sentence** for each action, because no module
// holds one and a chord with no sentence is a chord nobody can use. A missing
// sentence is a failure rather than a silent gap: the row is still drawn (a
// sheet that quietly omitted a chord would be the exact thing this file exists
// to prevent), carrying its action's own name, and `cheatsheet.test.mjs` fails
// the build until someone writes the line.
//
// **The chords that are not this island's are on it too**, in their own
// section, because the question the sheet answers is "what does this key do
// *here*" and the owner does not know which handler he is talking to. ⌘W is
// the default macOS menu's and behaves the way
// `desktop/src-tauri/src/vingilot_window/mod.rs` decides; the rest of that
// menu's accelerators are muda's table, which this app installs by setting no
// menu of its own and deliberately leaves alone. Neither can be generated from
// anything in this repository — one is a dependency's constant and the other is
// a native gesture — so they are written out below, and the test asserts the
// island claims none of them. That check is the ⌘W failure, expressed as a
// build error.

import {
  resolveCheatsheetKey,
  resolveOpenCheatsheetKey,
} from "./cheatsheetKeys.ts";
import { resolveColumnKey } from "./columnKeys.ts";
import { resolveDiffKey } from "./diffKeys.ts";
import { resolvePaletteKey, resolvePaletteListKey } from "./paletteKeys.ts";
import { resolveDividerKey, resolvePaneKey } from "./paneKeys.ts";
import { RATIO_STEP, RATIO_STEP_COARSE } from "./paneModel.ts";
import type { KeyInput } from "./terminalKeys.ts";
import { resolveKey } from "./terminalKeys.ts";

/** As much of a resolved action as this module reads. Every map's own action
 * type is narrower; what they share is a `type` and, sometimes, the fields
 * `actionKey` reads below. */
interface ResolvedAction {
  readonly type: string;
}

interface KeyMap {
  /** Which map answered. Part of a row's identity, so two maps that resolve
   * the same action name stay two rows — the divider's `solo` and the pane
   * host's `solo` are different keys on different surfaces. */
  readonly module: string;
  readonly resolve: (input: KeyInput) => ResolvedAction | null;
}

/** Every keyboard map in the island, in the order their rows are first met.
 * `scratchTerminal.ts`'s `resolveScratchKey` is deliberately absent: it
 * resolves nothing of its own, it re-reads the three maps below it to decide
 * what an open scratch shell shields, so listing it would print ⌥⌘T twice. */
const KEY_MAPS: readonly KeyMap[] = [
  { module: "sheet", resolve: resolveCheatsheetKey },
  { module: "sheet-open", resolve: resolveOpenCheatsheetKey },
  { module: "palette", resolve: resolvePaletteKey },
  { module: "terminal", resolve: resolveKey },
  { module: "column", resolve: resolveColumnKey },
  { module: "pane", resolve: resolvePaneKey },
  { module: "divider", resolve: resolveDividerKey },
  { module: "palette-open", resolve: resolvePaletteListKey },
  {
    module: "diff",
    // The one map with an input shape of its own. `inField` false is the
    // caller's own reading of "the caret is not in a text field", which is the
    // only state in which this map answers at all.
    resolve: (input) => resolveDiffKey({ ...input, inField: false }),
  },
];

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** The keys the maps are asked about, in the order a row's chords come out.
 * Bounded on purpose: a sheet built by enumerating every key a browser can
 * report would be a sheet nobody can read, and every chord in this island is
 * on a digit, a letter, an arrow, or one of the named keys below.
 *
 * The three composed characters are what macOS reports when ⌥ still applies to
 * a letter — ⌥t is "†", ⌥b is "∫", ⇧⌥b is "ı" — which `terminalKeys.ts` and
 * `paneKeys.ts` accept so the chord survives the composition. They fold back
 * onto their letter in `chordOf`.
 *
 * The order is the order a section's rows are read in, which is why the digits
 * are last: `⌘1…⌘9` and the divider's `0` are the ordinal cases, and each one
 * reads better after the thing it is an ordinal of. */
const KEY_SPACE: readonly string[] = [
  ...LETTERS,
  ...LETTERS.toUpperCase(),
  "`",
  "/",
  "†",
  "∫",
  "ı",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Enter",
  "Escape",
  "Tab",
  ...Array.from({ length: 10 }, (_unused, digit) => String(digit)),
];

const PRIMARY = 1;
const SHIFT = 2;
const ALT = 4;

/** Every modifier combination, fewest first. The order matters twice: it is
 * the order a row's chords are listed in, and it is what makes the fold below
 * keep ⇥ rather than ⇧⇥ when a map answers the same thing to both. */
const MOD_SPACE: readonly number[] = [
  0,
  SHIFT,
  ALT,
  ALT | SHIFT,
  PRIMARY,
  PRIMARY | SHIFT,
  PRIMARY | ALT,
  PRIMARY | ALT | SHIFT,
];

/** How a key is written on a sheet. Anything absent is written as it arrives —
 * a digit, a letter, `Home`, `End`, a backtick. */
const GLYPH: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Enter: "↵",
  Escape: "Esc",
  Tab: "⇥",
  "†": "T",
  "∫": "B",
  ı: "B",
};

/** The chord one keydown would be written as: ⇧ then ⌥ then ⌘, which is the
 * order every chord already written in this island uses (`paletteSources.ts`'s
 * `⇧⌥⌘B`), then the key.
 *
 * **A letter is capitalised only in a chord.** `⌘T` is how a menu writes it,
 * and capitalising is also what folds the caps-lock readings the maps accept —
 * a `T` arriving with no ⇧ — onto the same chord as `t`. An unmodified letter
 * is left as it is, because the Diff pane's `j` really is the lower-case key
 * and `J` there would read as ⇧J, which that map refuses. */
export function chordOf(input: KeyInput): string {
  const glyph = GLYPH[input.key] ?? input.key;
  const modified = input.primaryModifier || input.altKey === true;
  const key = modified && glyph.length === 1 ? glyph.toUpperCase() : glyph;
  return `${input.shiftKey === true ? "⇧" : ""}${
    input.altKey === true ? "⌥" : ""
  }${input.primaryModifier ? "⌘" : ""}${key}`;
}

/** A resolved action's identity for the purpose of a row.
 *
 * `index` and `dir` are dropped: which worktree and which way are not what a
 * row says, so ⌘1…⌘9 is one row and ⌥⌘← / ⌥⌘→ is one row. A `delta`'s
 * magnitude is kept and only its sign dropped, because on the divider ⇧ means
 * a bigger step — that is a different thing to know, and folding it away would
 * lose the only chord that says so. Everything else (`column`, `side`) is kept
 * whole: ⌘B and ⇧⌘B move different columns. */
function actionKey(action: ResolvedAction): string {
  const fields = Object.entries(action)
    .filter(([name]) => name !== "type" && name !== "index" && name !== "dir")
    .map(([name, value]) =>
      typeof value === "number"
        ? `${name}=${Math.abs(value)}`
        : `${name}=${String(value)}`,
    )
    .sort();
  return [action.type, ...fields].join(":");
}

export interface ResolvedChord {
  /** Which map answered. */
  module: string;
  /** The action, as a row identity — see `actionKey`. */
  action: string;
  chord: string;
  /** The key as it is written, for the fold below. */
  key: string;
  /** The modifiers held, as a bitmask. */
  mods: number;
}

/** **The generated set: every chord the island's maps really resolve.**
 *
 * Two folds, and each removes a chord that is not a second chord:
 *
 * 1. By the chord itself, so the caps-lock and ⌥-composed readings the maps
 *    accept (`T` for ⌘t, `†` for ⌥t) do not print as extra rows.
 * 2. By modifiers, when a map answers *the same action* to the same key with
 *    strictly fewer of them. ⇧⇥ is ⇥ with a modifier the palette ignores, and
 *    ⇧⌘/ is ⌘/ on a layout where "/" is shifted; neither is something to
 *    learn. It cannot fold anything real away, because a modifier that changes
 *    what happens changes the action, and a different action is a different
 *    row. */
export function resolvedChords(): readonly ResolvedChord[] {
  const byChord = new Map<string, ResolvedChord>();
  for (const map of KEY_MAPS) {
    for (const key of KEY_SPACE) {
      for (const mods of MOD_SPACE) {
        const input: KeyInput = {
          altKey: (mods & ALT) !== 0,
          key,
          primaryModifier: (mods & PRIMARY) !== 0,
          repeat: false,
          shiftKey: (mods & SHIFT) !== 0,
        };
        const action = map.resolve(input);
        if (action === null) continue;
        const chord = chordOf(input);
        const id = `${map.module} ${chord}`;
        if (byChord.has(id)) continue;
        byChord.set(id, {
          action: actionKey(action),
          chord,
          key: GLYPH[key] ?? key,
          mods,
          module: map.module,
        });
      }
    }
  }
  const found = [...byChord.values()];
  return found.filter(
    (hit) =>
      !found.some(
        (other) =>
          other !== hit &&
          other.module === hit.module &&
          other.action === hit.action &&
          other.key.toUpperCase() === hit.key.toUpperCase() &&
          (other.mods & hit.mods) === other.mods &&
          other.mods !== hit.mods,
      ),
  );
}

/** The sections, in the order they are read, and what each one is about. A
 * section with no generated rows is dropped rather than drawn empty. */
const SECTIONS = [
  { id: "workspace", note: null, title: "The workspace" },
  { id: "columns", note: null, title: "The columns" },
  { id: "panes", note: null, title: "The work surface" },
  {
    id: "divider",
    note: "the divider has to have focus — ⇥ to it from the terminal",
    title: "The divider",
  },
  { id: "terminal", note: null, title: "The terminal" },
  { id: "palette", note: "while the palette is open", title: "The palette" },
  {
    id: "diff",
    note: "with the caret outside a field",
    title: "The Diff pane",
  },
  {
    id: "elsewhere",
    note: "these are macOS's and the app's, not the workspace's",
    title: "Not the workspace's",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** The sentence for each action the maps can resolve, and which section it is
 * read in. Keyed by `<map>:<action key>` — the identity `resolvedChords`
 * produces — so an action that gains a discriminating field, or a map that
 * gains an action, arrives here as a missing key rather than as a wrong line.
 */
const WHAT: Record<string, { section: SectionId; what: string }> = {
  "column:toggle-column:column=sidebar": {
    section: "columns",
    what: "show or hide the app's own sidebar",
  },
  "column:toggle-column:column=worktrees": {
    section: "columns",
    what: "show or hide the worktree column",
  },
  "diff:open-file": {
    section: "diff",
    what: "open the file under the cursor — on a focused button it presses the button instead",
  },
  "diff:step-file": {
    section: "diff",
    what: "move the cursor through the changed files, opening nothing",
  },
  // Computed rather than written out: the step sizes are `paneModel.ts`'s, and
  // a number copied here would silently stop matching the day one of them
  // moved — leaving the row on the sheet with its own key printed as its
  // sentence.
  [`divider:nudge:delta=${RATIO_STEP}`]: {
    section: "divider",
    what: "move the split",
  },
  [`divider:nudge:delta=${RATIO_STEP_COARSE}`]: {
    section: "divider",
    what: "move the split in bigger steps",
  },
  "divider:reset-ratio": {
    section: "divider",
    what: "put the split back where it started",
  },
  "divider:solo:side=left": {
    section: "divider",
    what: "the terminal takes the whole surface",
  },
  "divider:solo:side=right": {
    section: "divider",
    what: "the right pane takes the whole surface",
  },
  "palette-open:close": {
    section: "palette",
    what: "close it, from wherever focus went — including a blocked row",
  },
  "palette-open:move:delta=1": {
    section: "palette",
    what: "move the cursor, wrapping rather than falling off either end",
  },
  "palette-open:refocus": {
    section: "palette",
    what: "straight back to the field — there is nothing here to tab to",
  },
  "palette-open:run": {
    section: "palette",
    what: "run the row under the cursor, or ask the question",
  },
  "palette:toggle-palette": {
    section: "workspace",
    what: "the palette — go anywhere, do anything. Again to put it away",
  },
  "pane:solo:side=left": {
    section: "panes",
    what: "give the terminal the whole surface, and back",
  },
  "pane:solo:side=right": {
    section: "panes",
    what: "give the right pane the whole surface, and back",
  },
  "sheet-open:close-cheatsheet": {
    section: "workspace",
    what: "close this sheet",
  },
  "sheet:toggle-cheatsheet": {
    section: "workspace",
    what: "this sheet. Again to put it away",
  },
  "terminal:close-terminal-tab": {
    section: "terminal",
    what: "close this terminal tab, and end its shell — ⌘W is the window's, below",
  },
  "terminal:focus-terminal": {
    section: "terminal",
    what: "put the keyboard in the terminal",
  },
  "terminal:leave-terminal": {
    section: "terminal",
    what: "leave the terminal, and give the keyboard back to the workspace",
  },
  "terminal:move-terminal-tab": {
    section: "terminal",
    what: "move the tab itself along the strip",
  },
  "terminal:new-terminal-tab": {
    section: "terminal",
    what: "another shell in this worktree, in a tab that stays",
  },
  "terminal:open-scratch-terminal": {
    section: "terminal",
    what: "the scratch shell — keeps nothing, and ends when you close it or leave. Again to close it",
  },
  "terminal:step-terminal-tab": {
    section: "terminal",
    what: "move between this worktree's terminal tabs",
  },
  "terminal:switch-worktree": {
    section: "workspace",
    what: "switch to the Nth worktree in the column",
  },
};

export interface CheatRow {
  /** Every chord that does this, in the order the maps answered. */
  chords: readonly string[];
  what: string;
}

export interface CheatSection {
  id: string;
  title: string;
  /** What is true of the whole section, or `null`. */
  note: string | null;
  rows: readonly CheatRow[];
}

/** The default macOS application menu's accelerators, verbatim from muda 0.19.3
 * src/items/predefined.rs:301-341 — the whole table, nothing omitted. This app
 * installs that menu by setting none of its own and takes nothing out of it,
 * which is why these chords work at all inside a WKWebView and why replacing
 * the menu to reclaim ⌘W was priced and declined
 * (`desktop/src-tauri/src/vingilot_window/mod.rs`).
 *
 * Exported because it is also an assertion: no chord the island resolves may
 * be one of these, and `cheatsheet.test.mjs` says so. That is the ⌘W failure
 * turned into a build error. */
export const MENU_CHORDS: readonly string[] = [
  "⌘W",
  "⌘Q",
  "⌘C",
  "⌘X",
  "⌘V",
  "⌘Z",
  "⇧⌘Z",
  "⌘A",
  "⌘M",
  "⌘H",
  "⌥⌘H",
  "⌃⌘F",
];

/** The rows no map can generate: a native gesture this app intercepts, and a
 * dependency's constant table. Written out, sourced in the comment above, and
 * held to the same "say what it does *here*" standard as everything above —
 * ⌘W in particular, whose whole point is that what it does here is not what
 * its name says. */
const ELSEWHERE: readonly CheatRow[] = [
  {
    chords: ["⌘W"],
    what: "takes what is on top — a dialog, else the palette, else this sheet, else the scratch shell. With nothing stacked the window minimizes into the Dock: it never hides, and it never closes",
  },
  {
    chords: ["⌘Q"],
    what: "quit — and every shell this app started ends with it, tmux's excepted",
  },
  { chords: ["⌘C", "⌘X", "⌘V"], what: "copy, cut, paste" },
  { chords: ["⌘A"], what: "select all" },
  { chords: ["⌘Z", "⇧⌘Z"], what: "undo, and redo" },
  { chords: ["⌘M"], what: "minimize the window into the Dock" },
  { chords: ["⌘H", "⌥⌘H"], what: "hide this app, and hide the others" },
  { chords: ["⌃⌘F"], what: "full screen" },
];

/** **The sheet.** Generated rows first, in section order, then the chords that
 * are not the island's. */
export function cheatsheet(): readonly CheatSection[] {
  const rows = new Map<string, { row: CheatRow; section: SectionId }>();
  for (const hit of resolvedChords()) {
    const id = `${hit.module}:${hit.action}`;
    const found = rows.get(id);
    if (found !== undefined) {
      // Every chord, whole. `chordRun` is the *drawing* and belongs to the
      // renderer: folding it in here would have the row itself claim that ⌘2
      // through ⌘8 are not bound, which is the one thing this file exists not
      // to say.
      found.row = { ...found.row, chords: [...found.row.chords, hit.chord] };
      rows.set(id, found);
      continue;
    }
    const described = WHAT[id];
    rows.set(id, {
      // A chord with no sentence still gets a row, carrying its own name: a
      // sheet that dropped it would be incomplete without saying so, which is
      // the failure this whole file is built against. The test is what makes
      // this state a build error rather than a shipped one.
      row: { chords: [hit.chord], what: described?.what ?? id },
      section: described?.section ?? "workspace",
    });
  }
  return SECTIONS.flatMap((section) => {
    const generated = [...rows.values()]
      .filter((entry) => entry.section === section.id)
      .map((entry) => entry.row);
    const all = section.id === "elsewhere" ? ELSEWHERE : generated;
    return all.length === 0
      ? []
      : [
          {
            id: section.id,
            note: section.note,
            rows: all,
            title: section.title,
          },
        ];
  });
}

/** What a row of chords is drawn as. A run of three or more chords that differ
 * only in a final consecutive digit — ⌘1…⌘9, the worktree switch — is drawn as
 * its two ends with this between them, because nine boxes in a row is a wall
 * rather than a shortcut. Every chord is still in the row's `chords`, which is
 * what the test reads: the elision is a drawing, not a claim about what is
 * bound. */
export const CHORD_ELISION = "…";

/** The modifiers a chord can lead with, in the order `chordOf` writes them.
 * ⌃ is here although nothing in this island binds it, because the sheet also
 * carries the default menu's ⌃⌘F. */
const MODIFIER_GLYPHS = "⇧⌥⌘⌃";

/** A chord split into the boxes it is drawn as: one per modifier held, then
 * the key as one box however many characters it takes.
 *
 * `[...chord]` was enough while every chord with a name on it was a single
 * letter after its modifiers, which is what the palette's rows are. It is not
 * enough here: this sheet carries `Esc`, and `Esc` in three boxes reads as
 * three keys pressed together. */
export function chordKeys(chord: string): readonly string[] {
  const chars = [...chord];
  let at = 0;
  while (at < chars.length && MODIFIER_GLYPHS.includes(chars[at] ?? "")) {
    at += 1;
  }
  const key = chars.slice(at).join("");
  return key.length === 0 ? chars.slice(0, at) : [...chars.slice(0, at), key];
}

export function chordRun(chords: readonly string[]): readonly string[] {
  if (chords.length < 3) return chords;
  const first = chords[0] ?? "";
  const stem = first.slice(0, -1);
  const digits = chords.map((chord) =>
    chord.startsWith(stem) && chord.length === first.length
      ? Number(chord.slice(-1))
      : Number.NaN,
  );
  const consecutive = digits.every(
    (digit, at) => Number.isInteger(digit) && digit === (digits[0] ?? 0) + at,
  );
  return consecutive
    ? [first, CHORD_ELISION, chords[chords.length - 1] ?? first]
    : chords;
}
