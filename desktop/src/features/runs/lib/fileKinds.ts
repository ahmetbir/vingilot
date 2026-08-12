// What kind of thing a file in the tree is, for the tree's one visual cue
// (vingilot/docs/plans/2026-08-12-polish-the-right-side.md, "the Files tree
// gets *restrained* file-kind cues").
//
// **Five kinds, not four hundred icons.** The cue this feeds is a tinted dot
// drawn like the sidebar's unread dot — the reader's question is "is this the
// code, the config, or a picture", not "which of nine JavaScript ecosystems".
// A kind is decided by name alone: no reads, no git, so the tree can classify
// two thousand rows in a render without asking anything.
//
// An unknown extension is `other`, which is an answer and not a gap — the dot
// for it is the neutral one, and neutral is what "this pane makes no claim"
// looks like. Pure: no Tauri, no React, tested in `fileKinds.test.mjs`.

export type FileKind = "code" | "config" | "doc" | "image" | "other";

const CODE = new Set([
  "bash",
  "c",
  "cjs",
  "cpp",
  "cs",
  "css",
  "dart",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "lua",
  "mjs",
  "mts",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
  "xml",
  "zsh",
]);

const CONFIG = new Set([
  "cfg",
  "conf",
  "env",
  "ini",
  "json",
  "jsonc",
  "lock",
  "plist",
  "properties",
  "toml",
  "yaml",
  "yml",
]);

const DOC = new Set(["adoc", "md", "mdx", "org", "rst", "txt"]);

const IMAGE = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "icns",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

/** Files whose whole name is the kind. The same names `fileViewer.ts` knows a
 * grammar for plus the extensionless documents every repository carries. */
const BY_NAME: Record<string, FileKind> = {
  ".editorconfig": "config",
  ".gitattributes": "config",
  ".gitignore": "config",
  ".gitmodules": "config",
  CHANGELOG: "doc",
  Dockerfile: "config",
  Justfile: "config",
  LICENSE: "doc",
  Makefile: "config",
  NOTICE: "doc",
  README: "doc",
  justfile: "config",
  makefile: "config",
};

export function fileKind(name: string): FileKind {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const named = BY_NAME[base];
  if (named !== undefined) return named;
  const dot = base.lastIndexOf(".");
  // A leading dot is a dotfile's dot, not an extension's — `.env` is config by
  // its own name, not by an extension called "env".
  if (dot <= 0) return base === ".env" ? "config" : "other";
  const ext = base.slice(dot + 1).toLowerCase();
  if (CODE.has(ext)) return "code";
  if (CONFIG.has(ext)) return "config";
  if (DOC.has(ext)) return "doc";
  if (IMAGE.has(ext)) return "image";
  return "other";
}
