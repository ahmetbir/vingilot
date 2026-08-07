// The two calls "add a project" has to make outside the webview: open the
// native folder picker, and ask what the picked directory is. No logic lives
// here — `repoChoice.ts` decides what an answer means and has the tests.
//
// **The dialog plugin was already this app's dependency.** `tauri-plugin-dialog`
// is in desktop/src-tauri/Cargo.toml, initialised in lib.rs, and `dialog:default`
// is granted in desktop/src-tauri/capabilities/default.json — which includes
// `allow-open`. What is *not* installed is `@tauri-apps/plugin-dialog`, the
// JavaScript wrapper, whose `open()` is one `invoke` of the command below and
// nothing else. Calling the command directly adds a project picker without
// adding a dependency, a lockfile change, or a seam; the cost is that this
// file, rather than a package, has to keep the argument shape right, which is
// why the shape is spelled out against the plugin's own types below.

import { invoke } from "@tauri-apps/api/core";

import { readRepoProbe, type RepoProbe } from "@/features/runs/lib/repoChoice";

/** `OpenDialogOptions` (tauri-plugin-dialog 2.7.1, src/commands.rs),
 * serde-renamed to camelCase. Only the fields this app sets. */
interface OpenDialogOptions {
  directory: boolean;
  multiple: boolean;
  title: string;
}

/** The native folder picker, or `null` when the owner cancelled.
 *
 * `directory: true, multiple: false` makes the plugin answer with
 * `OpenResponse::Folder(Option<FilePath>)`, which is `#[serde(untagged)]` —
 * so the wire value is the path string itself, or null. Anything else is
 * treated as a cancel rather than trusted into a path. */
export async function pickProjectDirectory(): Promise<string | null> {
  const options: OpenDialogOptions = {
    directory: true,
    multiple: false,
    title: "Add project",
  };
  const chosen = await invoke<unknown>("plugin:dialog|open", { options });
  return typeof chosen === "string" ? chosen : null;
}

/** What git makes of a directory (desktop/src-tauri/src/vingilot_repo/mod.rs).
 * `null` when the answer could not be read — never a fabricated verdict, and
 * in particular never a "this is fine" the caller would write state on. */
export async function probeRepo(path: string): Promise<RepoProbe | null> {
  return readRepoProbe(await invoke<unknown>("repo_probe", { path }));
}
