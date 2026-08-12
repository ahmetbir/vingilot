// The `vingilot_files` Tauri commands (desktop/src-tauri/src/vingilot_files/).
// No logic lives here: `filesModel.ts` decides what a listing means and what a
// refusal says, `fileViewer.ts` decides how a file is rendered, and both are
// tested without a backend.
//
// Every call answers rather than throws. A refusal is the ordinary outcome of
// both of these commands — a binary file, a file past the cap — so it is a value
// the pane renders, never an exception something has to remember to catch. The
// same shape `worktreeClient.ts` uses, for the same reason.

import { invoke } from "@tauri-apps/api/core";

import {
  type FilesError,
  readFilesError,
  type TreeListing,
} from "@/features/runs/lib/filesModel";

export type FilesResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FilesError };

/** Whatever came back from a rejected `invoke`, as a refusal. A shape this
 * build cannot read still has to reach the owner as words, so it is reported as
 * what it is — the backend, or the bridge to it, failing in a way this client
 * has no name for. It is deliberately not folded into one of the three bounds:
 * "this file is binary" would be a claim nothing made. */
function asError(thrown: unknown): FilesError {
  return (
    readFilesError(thrown) ?? {
      command: "vingilot_files",
      kind: "git-failed",
      stderr: String(thrown),
    }
  );
}

/** One directory level. `dir` is worktree-relative; `""` is the root. */
export async function readTree(
  worktree: string,
  dir: string,
): Promise<FilesResult<TreeListing>> {
  try {
    const listed = await invoke<TreeListing>("worktree_tree", {
      dir,
      worktree,
    });
    return { ok: true, value: listed };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

/** One file's text, or the sentence saying why not. */
export async function readFile(
  worktree: string,
  path: string,
): Promise<FilesResult<FileTextValue>> {
  try {
    const read = await invoke<FileTextValue>("file_read", { path, worktree });
    return { ok: true, value: read };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

/** What `vingilot_files::read::FileText` serialises to. `path` is echoed back
 * by the backend so a caller can drop an answer that arrived after it moved on
 * — a viewer that rendered whichever read landed last would show the wrong file
 * for the selected row. */
export interface FileTextValue {
  path: string;
  text: string;
  bytes: number;
  lines: number;
}
