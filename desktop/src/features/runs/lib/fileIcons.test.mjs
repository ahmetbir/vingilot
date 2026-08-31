import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extensionOf,
  FILE_ICON_TINT,
  FILE_ICON_TITLE,
  fileIconId,
} from "./fileIcons.ts";

test("the languages the owner named all resolve to their own glyph", () => {
  // The vocabulary P4.1 item 2 asks for, one assertion per family so a table
  // edit that drops one fails here rather than in a screenshot.
  const expected = {
    "Cargo.toml": "toml",
    "main.rs": "rust",
    "index.html": "html",
    "styles.css": "css",
    "app.tsx": "react",
    "deploy.sh": "shell",
    "logo.svg": "image",
    "notes.md": "markdown",
    "photo.PNG": "image",
    "run.py": "python",
    "schema.sql": "sql",
    "server.go": "go",
    "tsconfig.json": "json",
    "View.swift": "swift",
    "widget.jsx": "react",
    "worker.mjs": "js",
    "worktree.ts": "ts",
    "ci.yml": "yaml",
    "readme.txt": "text",
  };
  for (const [name, id] of Object.entries(expected)) {
    assert.equal(fileIconId(name), id, name);
  }
});

test("an extension nothing knows gets the plain document, not a guess", () => {
  // The honesty rule: drawing a `.rsx` with the Rust gear because the letters
  // looked close would be the tree claiming to know what a file is.
  assert.equal(fileIconId("mystery.qqq"), "file");
  assert.equal(fileIconId("Makefile"), "file");
  assert.equal(fileIconId("noextension"), "file");
});

test("a dotfile's name is not an extension", () => {
  // `.gitignore` is a file called `.gitignore`. Reading `gitignore` as a type
  // is how a dotfile ends up drawn as whatever that word collides with.
  assert.equal(extensionOf(".gitignore"), "");
  assert.equal(fileIconId(".gitignore"), "file");
  // But a dotfile WITH an extension still has one.
  assert.equal(extensionOf(".eslintrc.json"), "json");
  assert.equal(fileIconId(".eslintrc.json"), "json");
});

test("a lockfile outranks the language it happens to be written in", () => {
  // Three files nobody should hand-edit, which would otherwise look exactly
  // like the ones everybody does.
  assert.equal(fileIconId("pnpm-lock.yaml"), "lock");
  assert.equal(fileIconId("package-lock.json"), "lock");
  assert.equal(fileIconId("Cargo.lock"), "lock");
  // And the ordinary siblings keep their own.
  assert.equal(fileIconId("pnpm-workspace.yaml"), "yaml");
  assert.equal(fileIconId("package.json"), "json");
});

test("every glyph the mapping can return has a tint and a title", () => {
  // A new row in the extension table with no colour would render as the row's
  // own ink and read as the fallback.
  const ids = new Set(Object.keys(FILE_ICON_TINT));
  assert.deepEqual(
    ids,
    new Set(Object.keys(FILE_ICON_TITLE)),
    "the tint table and the title table must name the same glyphs",
  );
  for (const name of ["a.ts", "b.zzz", "Cargo.lock"]) {
    assert.ok(ids.has(fileIconId(name)), name);
  }
});
