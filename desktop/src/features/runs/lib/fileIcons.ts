// Which icon a filename gets, and what colour it wears — the mapping half of
// the file tree's VS Code-style language icons (redesign P4.1, item 2).
//
// **This is the one place the mockup is overruled, and it was overruled by the
// owner in as many words**: "sagdaki filetreedeki ikonlar sacma. direk
// vscodedaki gibi dile gore olmali, design orda yanlis yapmis." The mockup
// gives every file the same lettered `.flogo` chip — an "S" on every Swift
// file, an "M" on the markdown — which reads as one badge repeated rather than
// as a vocabulary. VS Code's file-icon themes do the opposite: a distinct
// silhouette per language, tinted, so a tree is scannable by shape before it
// is readable by name. **The licence is for this file and `FileIcon.tsx`
// only** — "dizayna sadik kal" stands everywhere else, including the folder
// glyph below, which is the mockup's own path traced exactly.
//
// **Seti's own approach, not Seti's assets.** The icons are single-colour
// glyphs tinted per language, which is what the Seti theme VS Code ships is;
// they are drawn inline in `FileIcon.tsx` rather than pulled from a package.
// The alternatives were all worse for a desktop app that already ships a
// 40MB webview: `vscode-icons` and `material-icon-theme` are thousands of
// multi-colour SVGs each (tens of MB unpacked) for the twenty families this
// tree actually meets, and `lucide-react` — which IS already a dependency —
// has no language marks at all. Twenty inline paths cost nothing to load, are
// themeable through `currentColor`, and add no supply chain.
//
// **The fallback is honest.** An extension this table does not know gets the
// plain document, not a guess: a `.foo` drawn with the Rust gear because the
// letters looked close would be the tree lying about what a file is.

/** Every glyph `FileIcon.tsx` can draw. A closed list on purpose — a name that
 * is not here has no drawing, and the type says so at the call site rather
 * than at runtime. */
export type FileIconId =
  | "css"
  | "file"
  | "folder"
  | "go"
  | "html"
  | "image"
  | "js"
  | "json"
  | "lock"
  | "markdown"
  | "python"
  | "react"
  | "rust"
  | "shell"
  | "sql"
  | "swift"
  | "text"
  | "toml"
  | "ts"
  | "yaml";

/** Extension (lower-case, no dot) to glyph. The table is the whole rule for
 * every file whose *name* does not decide it (see `NAMED` below). */
const BY_EXTENSION: Readonly<Record<string, FileIconId>> = {
  avif: "image",
  bash: "shell",
  bmp: "image",
  cjs: "js",
  css: "css",
  cts: "ts",
  fish: "shell",
  gif: "image",
  go: "go",
  htm: "html",
  html: "html",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  js: "js",
  json: "json",
  jsonc: "json",
  jsx: "react",
  less: "css",
  lock: "lock",
  log: "text",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  mjs: "js",
  mts: "ts",
  png: "image",
  py: "python",
  pyi: "python",
  rs: "rust",
  scss: "css",
  sh: "shell",
  sql: "sql",
  svg: "image",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "react",
  txt: "text",
  webp: "image",
  xml: "html",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

/** Whole names that outrank their extension.
 *
 * A lock file is a lock file whatever it is written in — `pnpm-lock.yaml` is
 * not a YAML document anybody reads, `Cargo.lock` is not TOML anybody edits —
 * and drawing it as one would make the three files in a repository nobody
 * should touch look exactly like the ones everybody does. */
const NAMED: Readonly<Record<string, FileIconId>> = {
  "cargo.lock": "lock",
  dockerfile: "text",
  "package-lock.json": "lock",
  "pnpm-lock.yaml": "lock",
  "yarn.lock": "lock",
};

/** The tint each glyph wears, as a Tailwind class.
 *
 * Decorative rather than informative: every row carries the file's own name
 * beside the icon, so the colour is a scanning aid and never the only carrier
 * of a fact. That is why these are not held to the text-contrast floor the
 * rest of this redesign measures — but they are still chosen well clear of the
 * ground, because an icon nobody can see is not an aid either. */
export const FILE_ICON_TINT: Readonly<Record<FileIconId, string>> = {
  css: "text-sky-300",
  file: "text-muted-foreground",
  // The mockup's `.fico` inherits the row's own ink; the folder is the one
  // glyph here that is traced from it, so it keeps that too.
  folder: "text-foreground/70",
  go: "text-cyan-300",
  html: "text-orange-400",
  image: "text-fuchsia-300",
  js: "text-yellow-300",
  json: "text-amber-300",
  lock: "text-muted-foreground",
  markdown: "text-slate-300",
  python: "text-blue-300",
  react: "text-cyan-300",
  rust: "text-orange-400",
  shell: "text-emerald-300",
  sql: "text-teal-300",
  swift: "text-orange-300",
  text: "text-slate-400",
  toml: "text-violet-300",
  ts: "text-sky-400",
  yaml: "text-violet-300",
};

/** A file's lower-case extension, or `""` for one with none.
 *
 * A leading dot is not an extension: `.gitignore` is a file called
 * `.gitignore`, and reading `gitignore` as its type is how a dotfile ends up
 * drawn as whatever that word happens to collide with. */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  if (at <= 0) return "";
  return name.slice(at + 1).toLowerCase();
}

/** Which glyph this file gets. Never `folder` — a directory is not a name
 * question, and the tree asks for that one directly. */
export function fileIconId(name: string): FileIconId {
  const whole = name.toLowerCase();
  if (Object.hasOwn(NAMED, whole)) return NAMED[whole];
  const ext = extensionOf(name);
  if (ext !== "" && Object.hasOwn(BY_EXTENSION, ext)) return BY_EXTENSION[ext];
  return "file";
}

/** What a screen reader would be told if this icon were not decorative — and
 * the row's `title`, so the vocabulary is learnable by hovering rather than by
 * memorising twenty silhouettes. */
export const FILE_ICON_TITLE: Readonly<Record<FileIconId, string>> = {
  css: "stylesheet",
  file: "file",
  folder: "folder",
  go: "Go",
  html: "markup",
  image: "image",
  js: "JavaScript",
  json: "JSON",
  lock: "lockfile",
  markdown: "Markdown",
  python: "Python",
  react: "React component",
  rust: "Rust",
  shell: "shell script",
  sql: "SQL",
  swift: "Swift",
  text: "plain text",
  toml: "TOML",
  ts: "TypeScript",
  yaml: "YAML",
};
