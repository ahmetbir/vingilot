// What the scratch markdown buffer *is*, in words
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// The scratch shell's sibling: one throwaway markdown buffer, one gesture away,
// for the thing he is holding in his head right now. Where the shell keeps
// nothing on purpose, this keeps everything on purpose — and the two claims sit
// one chord apart, so each has to say which one it is making.
//
// **One buffer, global, not one per worktree.** Task 4 says so and gives the
// reason: *"the scratch's whole point is that it follows him"*. He is in the
// middle of a worktree, remembers the thing he has to do to a different one,
// presses the chord and writes it down. A buffer keyed by worktree would have put
// that note in the checkout he happened to be standing in, which is the one place
// he will not be when he needs it. So the model here has no key at all — there is
// one file, at one path.
//
// **It never leaves this machine.** Said here, in `scratchClient.ts` and in the
// Rust module, because this app is a relay client and the wrong instinct is
// cheap: a scratch buffer on a work machine is where a password lives while it is
// being moved, where a customer's name is written down for ten minutes, where
// half a postmortem sits before anyone has decided whether it is shareable.
// Nothing publishes this text. If it is ever wanted on his phone that is a new
// decision with its own argument, not a call added to a client.
//
// Pure: the path and the copy. `scratchClient.ts` is the boundary,
// `scratchAutosave.ts` decides when a write happens, `useScratchMarkdown.ts` is
// the wiring, and the words below are pinned on screen by
// `tests/e2e/workspace-scratch-markdown.spec.ts`.

import type { PersistenceCopy } from "@/features/runs/lib/terminalPersistence";

/** The file, as the owner would type it.
 *
 * Written with `~` rather than resolved, because this is the form he can paste
 * into a terminal and the form his editor's Open dialog understands — and because
 * the real home directory is the backend's to know
 * (`vingilot_scratch::home`). The path is asserted against the file the backend
 * really writes by that module's own
 * `the_buffer_lands_at_the_one_path_this_module_will_ever_write`, so this string
 * and that behaviour cannot drift apart quietly. */
export const SCRATCH_MARKDOWN_PATH = "~/.vingilot/scratch.md";

/** What this buffer promises, and its limit — the mirror of
 * `SCRATCH_PERSISTENCE`, in the same shape and for the same reason.
 *
 * The shell's footer says *nothing is kept*. This one has to say the opposite
 * without leaving the owner to guess how far the opposite goes, so it names three
 * things: that the text survives closing and quitting, **where** it is (a real
 * file he can open himself), and that it goes no further than this machine. The
 * last is the half a footer usually drops, and it is the one he would otherwise
 * have to take on trust. */
export const SCRATCH_MARKDOWN_PRIVACY: PersistenceCopy = {
  detail: `The scratch buffer is one file on this machine, ${SCRATCH_MARKDOWN_PATH}, written a moment after you stop typing and read back when you open it. There is one of it — not one per worktree or project — because the point of a scratch is that it follows you. It survives closing this buffer, leaving the project and quitting the app, and it is ordinary markdown, so your own editor can have it. It is never sent anywhere: not to the relay, not to a channel, not to an agent. Nothing else in this app reads it.`,
  label: `scratch markdown: kept in ${SCRATCH_MARKDOWN_PATH} on this machine — never sent anywhere`,
  // The glance form, per terminalPersistence.ts's rule: a fact, never half a
  // promise. "kept on this machine" is this copy's whole claim in four words.
  short: "kept on this machine",
};

/** The empty buffer's own line, in the editor rather than as an empty state: a
 * textarea with a placeholder is already the designed moment for "nothing here
 * yet", and drawing a centred glyph over an editor would put a surface between
 * him and typing — which is the one thing `DocumentEditor` exists not to do. */
export const SCRATCH_MARKDOWN_PLACEHOLDER =
  "whatever you are holding in your head right now — markdown, kept as you type.";

/** What the pane says about itself under the save state, in `DocumentEditor`'s
 * `scope` slot. The notes pane's line says *not in the project, and not on a
 * server*; this one has to say the same thing about a path, since a real file in
 * his home directory is exactly the kind of thing that looks like it might
 * sync. */
export const SCRATCH_MARKDOWN_SCOPE = `one buffer for everything, kept in ${SCRATCH_MARKDOWN_PATH} — not in a project, and never sent anywhere.`;
