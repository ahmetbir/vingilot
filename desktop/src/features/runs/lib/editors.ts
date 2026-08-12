// Which editor the escape hatch opens, and how that is decided once
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 1; ADR-005 rung 3).
//
// > *"Detect what is installed, remember the choice, never guess between two."*
//
// **Three states, and the middle one is the whole design.** Nothing installed
// is a sentence (`vingilot_editor`'s own words, carried on the probe). Exactly
// one installed is not a choice at all — the button opens it, and asking would
// be a menu with one row. Several installed is the only case that needs the
// owner, and he is asked **once**: the pick is stored, and every button after
// that opens it directly with the menu still one click away for the day he
// switches.
//
// **Why not "the first one found".** Two editors installed and a silent pick
// between them is the app deciding which one his work lives in. He has Cursor
// open *and* `code` on his PATH for a build script — a guess would send him to
// the wrong window, and the second time it happened he would stop using the
// button. The plan's words are "never guess between two"; this file is that
// sentence.
//
// **Storage is `diffMode.ts`'s shape**, deliberately: a module singleton, a
// listener set, `localStorage` as a best-effort mirror, and a versioned key. It
// is **not** community-scoped and so is deliberately absent from
// `resetCommunityState()` — which editor is on this machine has nothing to do
// with which relay he is talking to, and there is no community data here to
// leak.
//
// Pure: no React, no Tauri. The React binding is `useEditors.ts` and the calls
// are `editorClient.ts`, so the rules below are tested with `node --test`.

/** The ids `vingilot_editor::EditorId` serialises. A closed set on both sides:
 * anything else stored, sent or read is not an editor. */
export type EditorId = "cursor" | "vscode" | "zed";

/** In probe order — the same order the backend walks, so the picker's rows and
 * the backend's answer cannot disagree about which is first. */
export const EDITOR_IDS: readonly EditorId[] = ["cursor", "vscode", "zed"];

const EDITOR_LABELS: Record<EditorId, string> = {
  cursor: "Cursor",
  vscode: "VS Code",
  zed: "Zed",
};

/** What the owner calls it. */
export function editorLabel(id: EditorId): string {
  return EDITOR_LABELS[id];
}

/** An id off the wire or out of storage, or `null`.
 *
 * **The one gate on this side.** A stored preference is a string somebody
 * else's build wrote, and the value travels to a Rust command that executes
 * something — so it is narrowed here rather than cast, and an unrecognised word
 * is treated as no preference at all rather than passed along to be refused
 * later. */
export function parseEditorId(value: unknown): EditorId | null {
  return typeof value === "string" &&
    (EDITOR_IDS as readonly string[]).includes(value)
    ? (value as EditorId)
    : null;
}

/** Versioned like the fork's other stored preferences (`diffMode.ts`): a later
 * shape change takes a new key, so an older build reading a newer record finds
 * nothing and falls back to asking. Falling back to *asking* is why an unknown
 * value is safe here in a way it would not be if the default were an editor. */
const STORAGE_KEY = "vingilot-editor.v1";

const listeners = new Set<() => void>();

function readStored(): EditorId | null {
  try {
    return parseEditorId(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

let chosen: EditorId | null = readStored();

/** The editor he picked, or `null` — he has not picked one. */
export function getChosenEditor(): EditorId | null {
  return chosen;
}

/** Record the pick and tell everyone reading it. A storage that refuses the
 * write costs the next restart one question and nothing else. */
export function setChosenEditor(next: EditorId): void {
  if (next === chosen) return;
  chosen = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Best effort: the in-memory value still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeChosenEditor(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget the pick. Test-only, and — unlike `diffMode`'s — also the thing the
 * "Open in…" menu would call if it ever grew a "forget this" row. It does not
 * have one: choosing a different editor from the menu *is* changing the answer,
 * and a second gesture that means almost the same is a second thing to learn. */
export function resetChosenEditorForTests(): void {
  chosen = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to undo.
  }
  for (const listener of listeners) listener();
}

/** What the button should do when it is pressed.
 *
 * - `none` — nothing installed; `refusal` is the backend's sentence.
 * - `open` — one editor to open, either because it is the only one or because
 *   he already chose it.
 * - `ask` — several installed and no choice made: the menu, once.
 *
 * `installed` is always carried, so a control that shows the menu on a
 * secondary gesture does not need a second call to find out what is on it. */
export type EditorAction =
  | { type: "none"; refusal: string }
  | { type: "open"; editor: EditorId; installed: readonly EditorId[] }
  | { type: "ask"; installed: readonly EditorId[] };

/** The default sentence for a probe that has not answered yet or came back
 * malformed. Never shown for "none installed" — that one is the backend's own
 * words, which name the three commands and how to install them. */
const NO_ANSWER =
  "the editor probe has not answered yet, so there is nothing to open in.";

/** The decision, from what is installed and what he chose before.
 *
 * **A stored choice that is no longer installed is ignored, not honoured.** He
 * chose Zed on the machine he had it on; on this one the pick names an editor
 * that is not here, and opening it would fail with a sentence about a missing
 * binary rather than showing him the two editors he does have. The pick is left
 * in storage rather than cleared — he may be on a machine he uses twice a year,
 * and un-choosing it for him is the thing `diffMode.ts` argues against. */
export function editorAction(
  installed: readonly EditorId[],
  chosen: EditorId | null,
  refusal: string | null,
): EditorAction {
  if (installed.length === 0) {
    return { refusal: refusal ?? NO_ANSWER, type: "none" };
  }
  if (installed.length === 1) {
    // Not a choice: one row is not a menu, and asking here would be the app
    // pretending it had a question.
    return { editor: installed[0] as EditorId, installed, type: "open" };
  }
  if (chosen !== null && installed.includes(chosen)) {
    return { editor: chosen, installed, type: "open" };
  }
  return { installed, type: "ask" };
}

/** What the button says. Named after the editor when there is one, so the row
 * is a promise about where the click lands rather than a category. */
export function editorButtonLabel(action: EditorAction): string {
  switch (action.type) {
    case "open":
      return `Open in ${editorLabel(action.editor)}`;
    case "ask":
      return "Open in editor…";
    case "none":
      return "Open in editor";
  }
}
