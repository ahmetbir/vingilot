// Pure keyboard-resolution for the team thread's composer: ⌘↵ sends what is
// typed, and a bare ↵ is a newline. Same shape as `terminalKeys.ts` — a
// `resolve*` function, so the map is unit-testable without React or a real
// keyboard, and the caller decides whether now is the time for it.
//
// **This is a module because of the cheatsheet.** The chord lived in
// `TeamThreadPane.tsx`'s own `onKeyDown`, where `cheatsheet.ts` cannot see it:
// that file generates its rows by asking every map in its `KEY_MAPS`, so a
// chord bound inside a component is a chord the sheet cannot print — while the
// sheet opens by claiming it carries every chord this workspace binds.
//
// **⌃↵ sends too, and the sheet says so in words rather than as a chord.** The
// caller passes "⌘ or ⌃" as `primaryModifier`, which is what the handler this
// replaced read, so the chord still works for hands that reach for ⌃.
// `cheatsheet.ts` enumerates ⇧, ⌥ and ⌘ and has no ⌃ to enumerate, so it would
// print the ⌘ reading alone — the row's sentence carries the other one instead
// of the sheet quietly dropping it.
//
// **No auto-repeat guard, unlike every other map in this island.** This
// composer is the stop-gap that upstream's own composer replaces
// (vingilot/docs/plans/2026-08-09-team-thread-fidelity.md), so the binding is
// moved out of the component as it stands rather than changed on its way out.
// What is expected to happen to this file: the send chord follows the composer.
// If upstream's composer keeps ⌘↵, this map is what the sheet reads it from and
// the wiring moves with it; if upstream binds something else, this file goes
// and the row leaves the sheet with it, which is the whole point of generating
// the sheet from the maps.

import type { KeyInput } from "./terminalKeys.ts";

/** Send the draft. One action, because there is one thing this map is for. */
export type ComposerKeyAction = { type: "send-message" };

/** Resolves one keydown in the composer into a send, or `null` when this map
 * has nothing to say about the key. Never throws.
 *
 * ⇧ and ⌥ are tolerated rather than refused, which is what the inline handler
 * did: a ⇧⌘↵ that put a newline in and sent nothing would be a message the
 * owner thinks he sent. */
export function resolveComposerKey(input: KeyInput): ComposerKeyAction | null {
  if (input.key !== "Enter") return null;
  if (!input.primaryModifier) return null;
  return { type: "send-message" };
}
