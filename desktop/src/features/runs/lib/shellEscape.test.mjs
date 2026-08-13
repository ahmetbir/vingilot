import assert from "node:assert/strict";
import { test } from "node:test";

import { shellEscapePath, shellEscapePaths } from "./shellEscape.ts";

test("an ordinary path is wrapped in single quotes", () => {
  assert.equal(shellEscapePath("/Users/y/file.txt"), "'/Users/y/file.txt'");
});

test("a space in the name does not split it into two arguments", () => {
  // The whole reason single quotes rather than nothing: bare, this is two
  // words to the shell and `cat` gets the wrong file.
  assert.equal(
    shellEscapePath("/Users/y/My Documents/a b.txt"),
    "'/Users/y/My Documents/a b.txt'",
  );
});

test("a single quote leaves and re-enters the quoting", () => {
  // The one byte single quotes cannot contain. `it's` -> it ++ '\'' ++ s.
  assert.equal(
    shellEscapePath("/tmp/it's here.txt"),
    "'/tmp/it'\\''s here.txt'",
  );
});

test("a name that is only a quote is one literal quote", () => {
  assert.equal(shellEscapePath("'"), "''\\'''");
});

test("double quotes are inert inside single quotes", () => {
  assert.equal(shellEscapePath('/tmp/"quoted".txt'), "'/tmp/\"quoted\".txt'");
});

test("shell metacharacters are literal, not evaluated", () => {
  // The attack this function exists to stop: none of these may reach the shell
  // as syntax. $(…), backticks, ; & | > all stay inside the quotes.
  const nasty = "/tmp/$(rm -rf ~)`whoami`;drop & true|cat>out.txt";
  assert.equal(shellEscapePath(nasty), `'${nasty}'`);
});

test("an ampersand does not background anything", () => {
  assert.equal(shellEscapePath("/tmp/a & b.txt"), "'/tmp/a & b.txt'");
});

test("unicode passes through unchanged", () => {
  assert.equal(
    shellEscapePath("/tmp/İşçi çÖ 日本語.md"),
    "'/tmp/İşçi çÖ 日本語.md'",
  );
});

test("the empty string is one empty argument, not nothing", () => {
  assert.equal(shellEscapePath(""), "''");
});

test("several paths are space-joined and each escaped", () => {
  assert.equal(
    shellEscapePaths(["/a/one.txt", "/b/two three.md", "/c/it's.log"]),
    "'/a/one.txt' '/b/two three.md' '/c/it'\\''s.log'",
  );
});

test("a single path joins to just that path, no trailing space", () => {
  assert.equal(shellEscapePaths(["/a/b.txt"]), "'/a/b.txt'");
});

test("no paths join to the empty string", () => {
  assert.equal(shellEscapePaths([]), "");
});
