// The `vingilot_scratch` Tauri commands
// (desktop/src-tauri/src/vingilot_scratch/mod.rs).
//
// **The only two calls the scratch buffer ever makes, and the whole of what
// leaves this app with its text in it.** That is worth stating here as well as in
// the Rust module: this app has a relay client, a websocket, an event-kind
// registry and a media uploader, and the scratch buffer touches none of them. A
// work machine's scratch does not leave the work machine — half a postmortem, a
// customer's name, a password being moved from one place to another all end up in
// a buffer like this one, and none of it is the relay's business. If a future
// change wants the buffer on his phone, that is a new decision with a new
// argument, not an extra call added here.
//
// No logic lives in this file. `scratchAutosave.ts` decides when a write happens,
// `scratchMarkdownKeys.ts` decides what the chord means, and both are tested
// without a backend.
//
// Every call answers rather than throws, the shape `filesClient.ts` and
// `worktreeClient.ts` use: a refusal is an ordinary outcome of both of these
// commands — a file somebody grew past the ceiling, a home directory that cannot
// be found, a disk with nothing left — so it is a value the surface renders,
// never an exception something has to remember to catch.

import { invoke } from "@tauri-apps/api/core";

/** The buffer as the backend answered.
 *
 * `text` is `null` for a machine that has never scratched anything — which is
 * **not** the same as `""`, and keeping them apart is the point: an empty read is
 * "no answer", never "nothing there", and only the `null` case permits a write.
 * A refusal must never be flattened into an empty buffer, or the first autosave
 * would write over a file this build merely could not open. */
export type ScratchRead =
  | { ok: true; text: string | null }
  | { ok: false; refusal: string };

/** Whatever came back from a rejected `invoke`, as a sentence.
 *
 * `vingilot_scratch` answers `Result<_, String>` and every one of its refusals is
 * already a whole sentence, so the common case is `String(thrown)` being exactly
 * that sentence. The fallback covers the shape this client cannot read — the
 * bridge itself failing — and says so rather than inventing one of the backend's
 * reasons. */
function asRefusal(thrown: unknown): string {
  const said = typeof thrown === "string" ? thrown : String(thrown);
  return said.length === 0
    ? "the scratch buffer's backend refused, and said nothing about why."
    : said;
}

/** The scratch buffer's text, or the sentence saying why it could not be read. */
export async function readScratch(): Promise<ScratchRead> {
  try {
    const text = await invoke<string | null>("scratch_read");
    return { ok: true, text: text ?? null };
  } catch (thrown) {
    return { ok: false, refusal: asRefusal(thrown) };
  }
}

/** Replace the scratch buffer. Returns whether the write landed — the caller
 * must not claim otherwise, which is the promise `scratchAutosave.ts` is built
 * on. */
export async function writeScratch(text: string): Promise<boolean> {
  try {
    await invoke("scratch_write", { text });
    return true;
  } catch {
    return false;
  }
}
