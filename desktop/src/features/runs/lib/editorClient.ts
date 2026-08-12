// The `vingilot_editor` and `vingilot_shim` Tauri commands. No logic lives
// here: `editors.ts` decides which editor a click opens and `openTarget.ts`
// decides where an incoming path lands, and both are tested without a backend.
//
// **Every call answers rather than throws**, the shape `filesClient.ts` and
// `worktreeClient.ts` already use — an editor that is not installed and a
// `/usr/local/bin` that will not take a symlink are ordinary outcomes here, not
// exceptions. The one thing this file adds to what the backend said is a
// sentence for the case where the *bridge* failed, because a rejected `invoke`
// still has to reach the owner as words.

import { invoke } from "@tauri-apps/api/core";

import { type EditorId, parseEditorId } from "@/features/runs/lib/editors";
import type { ShimLinkage } from "@/features/runs/lib/paletteSources";

/** What `editor_probe` answers: the installed editors, plus the backend's own
 * sentence when there are none. */
export interface EditorProbe {
  editors: EditorId[];
  refusal: string | null;
}

/** The probe, narrowed. **Ids are parsed rather than trusted** — the list
 * crosses the bridge and is then fed back to a command that executes something,
 * so an id this build does not know is dropped here rather than sent back. */
export async function probeEditors(): Promise<EditorProbe> {
  try {
    const probed = await invoke<{
      editors?: unknown;
      refusal?: unknown;
    }>("editor_probe");
    const editors = Array.isArray(probed.editors)
      ? probed.editors.flatMap((value) => {
          const id = parseEditorId(value);
          return id === null ? [] : [id];
        })
      : [];
    return {
      editors,
      refusal: typeof probed.refusal === "string" ? probed.refusal : null,
    };
  } catch (thrown) {
    return {
      editors: [],
      refusal: `the editor probe did not answer: ${String(thrown)}`,
    };
  }
}

/** `null` when it worked; the backend's refusal otherwise. */
export async function openInEditor(
  editor: EditorId,
  worktree: string,
  path: string,
  line: number | null,
): Promise<string | null> {
  try {
    await invoke("editor_open", { editor, line, path, worktree });
    return null;
  } catch (thrown) {
    return String(thrown);
  }
}

/** Where the `vingilot` shim is and whether it is on the wider PATH.
 *
 * The shape is `paletteSources.ts`'s `ShimLinkage` rather than a second
 * declaration of the same three fields: the ⌘K row is the only reader, and that
 * module cannot import this one (it must load under `node --test`, which has no
 * Tauri bridge), so the type belongs on its side of that wall. */
export async function readShimStatus(): Promise<ShimLinkage | null> {
  try {
    return await invoke<ShimLinkage>("shim_status");
  } catch {
    // No sentence: nothing asked for this. It is read to label a palette row,
    // and a row that says "Install…" when it is already installed is a smaller
    // wrong than a toast about a command the owner never mentioned.
    return null;
  }
}

/** The result of the explicit "Install vingilot command…" action. Always a
 * sentence, and `linked` says whether it is a done or a next step. */
export interface LinkOutcome {
  linked: boolean;
  sentence: string;
}

export async function installShimLink(): Promise<LinkOutcome> {
  try {
    return await invoke<LinkOutcome>("shim_install_link");
  } catch (thrown) {
    return {
      linked: false,
      sentence: `the vingilot command could not be installed: ${String(thrown)}`,
    };
  }
}
