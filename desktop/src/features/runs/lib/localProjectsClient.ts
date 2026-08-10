// The two calls the local project list has to make outside the webview: read
// the file, and write it. No logic lives here — `localProjects.ts` decides
// what the bytes mean and has the tests, the same split `repoClient.ts` keeps
// against `repoChoice.ts`.
//
// **A rejection is an answer, not an exception.** Outside a Tauri host — a
// browser preview, the E2E bridge, which throws on any command it does not
// mock — `invoke` rejects, and that is the honest report that this machine has
// no local store rather than that the store is empty. The caller must be able
// to tell those apart (see `useLocalProjects.ts`), so nothing here throws.

import { invoke } from "@tauri-apps/api/core";

export type LoadLocalProjects =
  /** `text: null` means there is no file yet — a machine that has not added a
   * project. Distinct from a failure, and the distinction is the whole reason
   * this is a result type. */
  { ok: true; text: string | null } | { ok: false; reason: string };

export async function loadLocalProjectsFile(): Promise<LoadLocalProjects> {
  try {
    const answer = await invoke<unknown>("projects_load");
    if (answer === null || answer === undefined)
      return { ok: true, text: null };
    if (typeof answer === "string") return { ok: true, text: answer };
    return { ok: false, reason: "the project store answered with no text" };
  } catch (thrown) {
    return { ok: false, reason: String(thrown) };
  }
}

export type SaveLocalProjects = { ok: true } | { ok: false; reason: string };

export async function saveLocalProjectsFile(
  contents: string,
): Promise<SaveLocalProjects> {
  try {
    await invoke("projects_save", { contents });
    return { ok: true };
  } catch (thrown) {
    return { ok: false, reason: String(thrown) };
  }
}
