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

/** One file's bytes, base64'd, or the sentence saying why not — the picture
 * half of the viewer (`filePreview.ts`).
 *
 * **A second command rather than a flag on `file_read`**, because they refuse
 * different things and under different bounds: `file_read` turns a file with a
 * NUL in it away (a viewer showing a JPEG's bytes as text is the failure it
 * exists to prevent), and this one is asked precisely for those files. The two
 * caps differ for the same reason and each says its own number when it is hit. */
export async function readFileBytes(
  worktree: string,
  path: string,
): Promise<FilesResult<FileBytesValue>> {
  try {
    const read = await invoke<FileBytesValue>("file_bytes", { path, worktree });
    return { ok: true, value: read };
  } catch (thrown) {
    return { error: asError(thrown), ok: false };
  }
}

/** What `vingilot_files::bytes::FileBytes` serialises to.
 *
 * **The ceiling is in the type, not in a truncation.** `cap` is the number the
 * backend applied, echoed with every answer, so the pane can say what the bound
 * was without holding a second copy of it that could drift; and a file past it
 * comes back as a `too-large` refusal carrying the same number rather than as a
 * half-picture. There is no path here that returns some of a file. */
export interface FileBytesValue {
  path: string;
  /** Standard base64, no line breaks — the file's bytes exactly as they are on
   * disk, ready to be the tail of a `data:` URL. */
  base64: string;
  bytes: number;
  cap: number;
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
