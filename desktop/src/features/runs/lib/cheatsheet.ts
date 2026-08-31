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
// **The bound on that, said plainly:** it holds for a chord on a key in
// `KEY_SPACE` below, in a map in `KEY_MAPS` below. Both lists are hand-written,
// and a chord on a key outside the first — `⌘;`, say — resolves perfectly well
// at runtime and never appears here. That is why a chord belongs in a
// `resolve*` module rather than in a component's own `onKeyDown`: a map this
// file does not know about is a chord this sheet cannot print, and that is the
// hole `cardKeys.ts` was pulled out of.
//
// What is written down is the **sentence** for each action, because no module
// holds one and a chord with no sentence is a chord nobody can use. A missing
// sentence is a failure rather than a silent gap: the row is still drawn (a
// sheet that quietly omitted a chord would be the exact thing this file exists
// to prevent), carrying its action's own name, and `cheatsheet.test.mjs` fails
// the build until someone writes the line.
//
// **Chords that are not this island's are on it too**, in their own section,
// because the question the sheet answers is "what does this key do *here*" and
// the owner does not know which handler he is talking to. Three kinds sit
// there: ⌘W, which behaves the way
// `desktop/src-tauri/src/vingilot_window/mod.rs` decides; the rest of the
// default macOS menu's accelerators, which are muda's constant table, installed
// because this app sets no menu of its own and deliberately leaves that one
// alone; and the app's own chords that reach this screen from outside the
// island — ⌃Space, ⌘+/⌘-/⌘0, ⌘, and ⌘R. None of them can be generated from
// anything here: one is a native gesture, one is a dependency's constant, and
// the rest live in maps written before this island and outside it. So they are
// written out below, each sourced in `ELSEWHERE`'s comment, and the test
// asserts the island resolves none of them. That check is the ⌘W failure,
// expressed as a build error.

import { resolveCardKey } from "./cardKeys.ts";
import { resolveCloseKey } from "./closeKeys.ts";
import {
  resolveCheatsheetKey,
  resolveOpenCheatsheetKey,
} from "./cheatsheetKeys.ts";
import { resolveColumnKey } from "./columnKeys.ts";
import { resolveDiffKey } from "./diffKeys.ts";
import { resolvePaletteKey, resolvePaletteListKey } from "./paletteKeys.ts";
import { resolveDividerKey, resolvePaneKey } from "./paneKeys.ts";
import { resolvePlaceKey, resolvePlaceListKey } from "./placeKeys.ts";
import { RATIO_STEP, RATIO_STEP_COARSE } from "./paneModel.ts";
import { resolveScratchMarkdownKey } from "./scratchMarkdownKeys.ts";
import { resolveSearchKey } from "./searchKeys.ts";
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
 *
 * Two maps are deliberately absent, both for one reason: they resolve nothing of
 * their own. `scratchTerminal.ts`'s `resolveScratchKey` and
 * `scratchMarkdownKeys.ts`'s `resolveScratchMarkdownShield` re-read the maps
 * below to decide what an open scratch surface shields, so listing either would
 * print its own chord twice and would print ⌘T, ⌘`, ⌘1…9 and ⌥⌘B again as
 * "shield". What the sheet has to say about those chords is what they do, which
 * is the row the map that owns them already generates. */
const KEY_MAPS: readonly KeyMap[] = [
  { module: "close", resolve: resolveCloseKey },
  { module: "sheet", resolve: resolveCheatsheetKey },
  { module: "sheet-open", resolve: resolveOpenCheatsheetKey },
  { module: "palette", resolve: resolvePaletteKey },
  { module: "place", resolve: resolvePlaceKey },
  { module: "place-open", resolve: resolvePlaceListKey },
  { module: "search", resolve: resolveSearchKey },
  { module: "scratch-md", resolve: resolveScratchMarkdownKey },
  { module: "terminal", resolve: resolveKey },
  { module: "column", resolve: resolveColumnKey },
  { module: "pane", resolve: resolvePaneKey },
  { module: "divider", resolve: resolveDividerKey },
  { module: "palette-open", resolve: resolvePaletteListKey },
  { module: "deck", resolve: resolveCardKey },
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
 * **The cost of the bound, stated rather than hoped away:** a map that answered
 * on a key that is not in this list would resolve at runtime and never print,
 * and nothing would fail. `⌘;` is the shape of it. Adding a chord means adding
 * its key here too, and this list is the place to look when a chord works and
 * the sheet does not know it.
 *
 * The four composed characters are what macOS reports when ⌥ still applies to
 * a letter — ⌥t is "†", ⌥b is "∫", ⇧⌥b is "ı", ⌥m is "µ" — which
 * `terminalKeys.ts`, `paneKeys.ts` and `scratchMarkdownKeys.ts` accept so the
 * chord survives the composition. They fold back onto their letter in `chordOf`.
 *
 * The order is the order a section's rows are read in, which is why the digits
 * are last: `⌘1…⌘9` and the divider's `0` are the ordinal cases, and each one
 * reads better after the thing it is an ordinal of. */
const KEY_SPACE: readonly string[] = [
  ...LETTERS,
  ...LETTERS.toUpperCase(),
  "`",
  "/",
  // Both readings of the tab split's chord: macOS reports "|" for the shifted
  // backslash on a US layout and "\\" where the backslash is not shifted.
  // `GLYPH` folds the first onto the second so they print as one row.
  "\\",
  "|",
  "†",
  "∫",
  "ı",
  "µ",
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
/** The raw Control key. Every map but `placeKeys.ts` ignores it — the rest read
 * `primaryModifier`, which on macOS is ⌘ and explicitly not ⌃ — so enumerating
 * it produces a ⌃-prefixed twin of nearly every chord in the island. Every one
 * of those twins is folded away by the rule below (same map, same action, same
 * key, strictly fewer modifiers), which is the honest outcome: ⌃⌘K really does
 * open the palette, and it is not a second thing to learn. What survives the
 * fold is the chord that only resolves *with* ⌃, which is exactly ⌃⇥.
 *
 * Only ⌃ and ⇧⌃ are enumerated, not the other six combinations it could join.
 * Same bound, and same cost, as `KEY_SPACE`'s: no map in this island answers to
 * ⌃ alongside ⌥ or ⌘ — `placeKeys.ts` refuses ⌥ by `altKey` and ⌘ by `metaKey`,
 * both explicitly — so the six would generate twins and nothing else. If a map
 * is ever written that does, its combination belongs here too, and this
 * paragraph is where to look.
 *
 * **`metaKey` is not enumerated at all, and `PRIMARY` is not a stand-in for
 * it.** The bit below means "the platform's primary modifier", which `chordOf`
 * writes as ⌘ because this app is written on a Mac; off-mac it is Ctrl, so
 * `CTRL | PRIMARY` would not be a second chord to print but the same ⌃⇥ spelled
 * with a modifier the platform already resolved. The one map that reads the
 * physical ⌘ therefore cannot be refused by anything this enumeration sets,
 * which is why ⌃⇥ prints on every platform — the same answer the app now
 * gives. */
const CTRL = 8;

/** Every modifier combination, fewest first. The order matters twice: it is
 * the order a row's chords are listed in, and it is what makes the fold below
 * keep ⇥ rather than ⇧⇥ when a map answers the same thing to both. ⌃ is last
 * for that second reason: a ⌃-less reading must be met first so the twin it
 * folds away has something to be folded onto. */
const MOD_SPACE: readonly number[] = [
  0,
  SHIFT,
  ALT,
  ALT | SHIFT,
  PRIMARY,
  PRIMARY | SHIFT,
  PRIMARY | ALT,
  PRIMARY | ALT | SHIFT,
  CTRL,
  CTRL | SHIFT,
];

/** How a key is written on a sheet. Anything absent is written as it arrives —
 * a digit, a letter, `Home`, `End`, a backtick. */
const GLYPH: Record<string, string> = {
  "|": "\\",
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
  µ: "M",
};

/** The chord one keydown would be written as: ⇧ then ⌥ then ⌃ then ⌘, which is
 * the order every chord already written in this island uses
 * (`paletteSources.ts`'s `⇧⌥⌘B`) with ⌃ placed where the two chords this sheet
 * already carries put it (`⌃⌘F`, muda's own spelling), then the key.
 *
 * **A letter is capitalised only in a chord.** `⌘T` is how a menu writes it,
 * and capitalising is also what folds the caps-lock readings the maps accept —
 * a `T` arriving with no ⇧ — onto the same chord as `t`. An unmodified letter
 * is left as it is, because the Diff pane's `j` really is the lower-case key
 * and `J` there would read as ⇧J, which that map refuses. */
export function chordOf(input: KeyInput): string {
  const glyph = GLYPH[input.key] ?? input.key;
  const modified =
    input.primaryModifier || input.altKey === true || input.ctrlKey === true;
  const key = modified && glyph.length === 1 ? glyph.toUpperCase() : glyph;
  return `${input.shiftKey === true ? "⇧" : ""}${
    input.altKey === true ? "⌥" : ""
  }${input.ctrlKey === true ? "⌃" : ""}${input.primaryModifier ? "⌘" : ""}${key}`;
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
          ctrlKey: (mods & CTRL) !== 0,
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
    id: "switcher",
    note: "while ⌃ is still held down",
    title: "The place switcher",
  },
  {
    id: "diff",
    note: "with the caret outside a field",
    title: "The Diff pane",
  },
  { id: "deck", note: "on a focused card", title: "The deck" },
  // No "team thread" section: that pane hosts upstream's composer now, and its
  // keys are the ones every other channel has. A sheet built from this island's
  // maps has nothing of its own to say about them, and inventing a section for
  // someone else's chord is how a cheatsheet starts lying.
  {
    id: "elsewhere",
    // Deliberately a claim about the rows below rather than about coverage:
    // this section is hand-written, so "all of the app's" is something it
    // cannot promise. What it can promise is that the workspace answers to
    // none of what is printed here, and `cheatsheet.test.mjs` generates that
    // over the island's maps rather than reading it off the list.
    note: "the workspace binds none of these — they are the macOS menu's and the app's",
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
  // One column row only: ⇧⌘B is retired with the second sidebar it used to
  // hide (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2), and the
  // sheet is generated, so its row left when `columnKeys.ts` stopped
  // answering the chord.
  "column:toggle-column:column=sidebar": {
    section: "columns",
    what: "show or hide the app's own sidebar — the workspace nav lives inside it",
  },
  "deck:move-card": {
    section: "deck",
    what: "move the card along the deck, without a mouse",
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
  // **The three doors, one line each** (vingilot/docs/plans/
  // 2026-08-12-an-ide-of-a-kind.md, Task 2). One palette, three opening lists;
  // the prefixes are on every line because a grammar taught in one place is a
  // grammar he learns in whichever door he opened.
  "palette:toggle-palette:door=go": {
    section: "workspace",
    what: "go anywhere — projects, worktrees, channels, the files you have opened, and every command. The same key everywhere in this app now. Type > for commands or # for channels; again to put it away",
  },
  "palette:toggle-palette:door=files": {
    section: "workspace",
    what: "open a file in this worktree, by name. Nothing else is in this list; > and # still switch, and on a screen with no checkout the key is not ours",
  },
  "palette:toggle-palette:door=commands": {
    section: "workspace",
    what: "run a command — the panes and the actions, without the places. The same list a > gets you from any door",
  },
  "place-open:cancel": {
    section: "switcher",
    what: "stay where you are — let go of ⌃ afterwards and nothing moves",
  },
  "place:step:delta=1": {
    section: "workspace",
    what: "hold ⌃ and press ⇥ to walk back through where you have been; ⇧⇥ walks the other way. Letting go of ⌃ lands you there, and a quick tap goes straight to the last place",
  },
  "pane:solo:side=left": {
    section: "panes",
    what: "give the terminal the whole surface, and back",
  },
  "pane:solo:side=right": {
    section: "panes",
    what: "give the right pane the whole surface, and back",
  },
  "scratch-md:open-scratch-markdown": {
    section: "workspace",
    what: "the scratch markdown buffer — one of it, wherever you are, kept in ~/.vingilot/scratch.md on this machine and never sent anywhere. Again to put it away, and Esc does too",
  },
  "search:open-search": {
    section: "workspace",
    what: "find something in this worktree's checkout — git's own search, so it reads what git reads. ⌘F is still find-in-this-channel",
  },
  "sheet-open:close-cheatsheet": {
    section: "workspace",
    what: "close this sheet",
  },
  "sheet:toggle-cheatsheet": {
    section: "workspace",
    what: "this sheet. Again to put it away",
  },
  "close:close-top": {
    section: "workspace",
    what: "takes what is on top — a dialog, else the palette, else this sheet, else a scratch (markdown, then shell), else the tab in the focused half of the stage when it is not the worktree's last shell. Past all of that the window minimizes into the Dock: it never hides, and it never closes. A caret in a text field keeps its own ⌘W",
  },
  "terminal:close-terminal-tab": {
    section: "terminal",
    what: "close this terminal tab and end its shell, whatever is stacked over it — ⌘W is the one that takes the top of the stack first",
  },
  "terminal:toggle-tab-split": {
    section: "terminal",
    what: "put two TABS side by side on the stage — a reading beside a shell, or two readings — with a divider between them. Again to put the stage back. Not ⌘D, which is two shells inside one tab, and not the diff's own Split button, which is how one patch is drawn",
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
  "terminal:new-task": {
    section: "terminal",
    what: "a new task on the Deck's strip — its own chip, its own set of terminal tabs. Another tab inside the current task is the tab bar's +",
  },
  "terminal:split-terminal:direction=down": {
    section: "terminal",
    what: "split this terminal down — a second live shell below it, with a draggable divider",
  },
  "terminal:split-terminal:direction=right": {
    section: "terminal",
    what: "split this terminal right — a second live shell beside it, with a draggable divider",
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
    what: "switch to the Nth worktree under the open project",
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

/** **The macOS application menu's accelerators — the ones this app's menu still
 * carries.** They come from muda 0.19.3 src/items/predefined.rs:301-341 by way
 * of `desktop/src-tauri/src/app_menu.rs`, which builds `Menu::default()` minus
 * both `close_window` items and is installed at `lib.rs:315`. That subtraction
 * is why **⌘W is no longer on this list**: no accelerator named ⌘W survives in
 * the menu, so the keystroke reaches the webview and the island resolves it
 * (`closeKeys.ts`, which carries the re-run audit and names what still closes
 * the window).
 *
 * Exported because it is also an assertion: no chord the island resolves may
 * be one of these, and `cheatsheet.test.mjs` says so. That is the ⌘W failure
 * turned into a build error — and correcting the list when the menu itself
 * changed is the other half of keeping the assertion honest, since a stale
 * entry fails a claim that is true rather than catching one that is not. */
export const MENU_CHORDS: readonly string[] = [
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

/** The rows no map here can generate: a native gesture this app intercepts, a
 * dependency's constant table, and the app's own chords that reach this screen
 * from outside the island. Written out, sourced below, and held to the same
 * "say what it does *here*" standard as everything above — ⌘W in particular,
 * whose whole point is that what it does here is not what its name says.
 *
 * The app's own, each read out of its handler rather than remembered:
 *
 * - `⌃Space` — `src-tauri/src/ptt_shortcut.rs:27`, the only chord this app
 *   reserves with the whole system, and only while a huddle is connected and
 *   its voice input is push-to-talk (`should_register`, same file).
 * - `⌘+` / `⌘-` / `⌘0` — `app/useWebviewZoomShortcuts.ts`. It scales the root
 *   font size between 0.75 and 1.5 and pins the webview's own zoom at 1, so
 *   what moves is text on the rem scale and nothing else.
 * - `⌘,` — `app/useSettingsShortcuts.ts`, which opens settings and, with them
 *   already open, closes them.
 * - `⌘R` — `app/useReloadShortcut.ts`, which closes the relay's sockets (or
 *   gives up after 500 ms) and then reloads the webview.
 *
 * **This list is not the whole of "outside the island", and does not claim to
 * be** — that is why the section's note is a claim about these rows rather
 * than about coverage. Upstream's own window map (⌘K, ⇧⌘K, ⇧⌘N, ⇧⌘O, ⇧⌘A in
 * `app/AppShell.tsx`, ⌘[ / ⌘] in
 * `app/navigation/useBackForwardControls.ts`, Escape in
 * `app/useMarkAsReadShortcuts.ts`) is mounted at the root route and so is
 * technically live here, but every one of those chords is *about* a surface
 * this screen does not show, and several are contested by the island's own
 * maps in an order nothing in this repository asserts. Printing them as
 * answers would be printing a guess. */
const ELSEWHERE: readonly CheatRow[] = [
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
  {
    chords: ["⌘+", "⌘-"],
    what: "text bigger, and smaller — 0.75× to 1.5×, and only text sized on the rem scale moves",
  },
  { chords: ["⌘0"], what: "text back to its own size" },
  { chords: ["⌘,"], what: "settings. Again to close them" },
  {
    chords: ["⌘R"],
    what: "reload the app — the relay's sockets are closed first, then the page goes",
  },
  {
    chords: ["⌃Space"],
    what: "hold to talk, and only while a huddle is connected and set to push-to-talk. The one chord this app takes from the whole system rather than from a window",
  },
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
 * carries the default menu's ⌃⌘F and the app's own ⌃Space. */
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
