import assert from "node:assert/strict";
import { test } from "node:test";

import { fileKind } from "./fileKinds.ts";

test("a kind is read from the extension, case-insensitively", () => {
  assert.equal(fileKind("src/main.rs"), "code");
  assert.equal(fileKind("desktop/src/app/App.TSX"), "code");
  assert.equal(fileKind("Cargo.toml"), "config");
  assert.equal(fileKind("a/b/settings.YAML"), "config");
  assert.equal(fileKind("docs/notes.md"), "doc");
  assert.equal(fileKind("assets/logo.png"), "image");
});

test("a file whose whole name is the kind is named by it", () => {
  // A Dockerfile has no extension and is not "other"; neither is a LICENSE.
  assert.equal(fileKind("Dockerfile"), "config");
  assert.equal(fileKind("deep/dir/Justfile"), "config");
  assert.equal(fileKind(".gitignore"), "config");
  assert.equal(fileKind("LICENSE"), "doc");
  assert.equal(fileKind("README"), "doc");
});

test("a dotfile's dot is not an extension", () => {
  // `.env` is config by its own name — reading "env" as an extension would be
  // an accident of the same characters.
  assert.equal(fileKind(".env"), "config");
  // An unknown dotfile makes no claim.
  assert.equal(fileKind(".zshrc"), "other");
});

test("an unknown extension is other, which is an answer and not a gap", () => {
  // The dot for `other` is the neutral one: this pane makes no claim about a
  // parquet file, and neutral is what no claim looks like.
  assert.equal(fileKind("data.parquet"), "other");
  assert.equal(fileKind("archive.tar.gz"), "other");
  assert.equal(fileKind("noext"), "other");
});
