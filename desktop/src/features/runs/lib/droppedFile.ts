// Turn a native drop's filesystem path back into the `File` the app's HTML5
// uploaders already know how to take (vingilot/seams/drag-and-drop.yaml).
//
// **Why a round trip through Rust.** With the window's native drop enabled the
// webview is handed a path, not the bytes — the exact opposite of the HTML5
// path, which handed bytes and an empty `File.path`. Every in-app drop target
// (composer attachments, persona import, agent avatar, backup restore) reads
// bytes, so the path is read back to bytes here through one small Rust command
// (`vingilot_drop_read`) and wrapped in a `File`, and every downstream uploader
// is reused untouched. Nothing here caps or sniffs; the Rust side owns the size
// bound and the relay owns the deny-list, exactly as they did for the blob.

import { invoke } from "@tauri-apps/api/core";

/** The last path segment, splitting on both separators so a Windows-shaped path
 * (should one ever arrive) still yields a bare name rather than the whole
 * thing. */
export function basename(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] ?? path;
}

/** A best-effort content type from the extension, for the uploaders that branch
 * on `File.type`. An unknown extension is `""` — the same thing the browser
 * hands a file it cannot type, and the Rust/relay side infers from bytes
 * regardless. */
export function mimeForName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "pdf":
      return "application/pdf";
    case "zip":
      return "application/zip";
    case "json":
      return "application/json";
    default:
      return "";
  }
}

/** Read one dropped path's bytes back across the Tauri boundary. */
export async function readDroppedFile(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("vingilot_drop_read", { path });
  return new Uint8Array(bytes);
}

/** One dropped path, as a `File` an HTML5 uploader can take. */
export async function fileFromPath(path: string): Promise<File> {
  const bytes = await readDroppedFile(path);
  const name = basename(path);
  // `bytes as BlobPart`: a `Uint8Array` is a valid `BlobPart` at runtime, but
  // the DOM lib types its backing buffer as possibly `SharedArrayBuffer`, which
  // the `File` constructor's `ArrayBuffer`-only view rejects at compile time.
  // The cast asserts what is always true here — the array came from `invoke`,
  // never a shared buffer.
  return new File([bytes as BlobPart], name, { type: mimeForName(name) });
}

/** Every dropped path, read in parallel, as `File`s. Order is preserved so a
 * target that cares which file is first (the avatar takes `files[0]`) sees the
 * order the OS reported. */
export function filesFromPaths(paths: readonly string[]): Promise<File[]> {
  return Promise.all(paths.map(fileFromPath));
}
