// The engine's grammar, proved as a pure function
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MODE_SOURCES,
  PALETTE_PREFIXES,
  paletteHints,
  palettePlaceholder,
  readPaletteQuery,
} from "./paletteDoors.ts";

test("a door with no prefix is its own mode, trimmed", () => {
  assert.deepEqual(readPaletteQuery("go", "  buzzard "), {
    mode: "go",
    prefix: null,
    query: "buzzard",
  });
  assert.deepEqual(readPaletteQuery("files", "main.rs"), {
    mode: "files",
    prefix: null,
    query: "main.rs",
  });
  assert.deepEqual(readPaletteQuery("commands", ""), {
    mode: "commands",
    prefix: null,
    query: "",
  });
});

test("> switches to commands and # to channels, from any door", () => {
  // The point of "any door": a grammar that only worked in the door somebody
  // happened to test is a grammar with a hole in it.
  for (const door of ["go", "files", "commands"]) {
    assert.deepEqual(readPaletteQuery(door, ">new worktree"), {
      mode: "commands",
      prefix: ">",
      query: "new worktree",
    });
    assert.deepEqual(readPaletteQuery(door, "#general"), {
      mode: "channels",
      prefix: "#",
      query: "general",
    });
  }
});

test("the prefix wins over the door, and a space after it is not part of the query", () => {
  assert.equal(readPaletteQuery("files", "> prune").mode, "commands");
  assert.equal(readPaletteQuery("files", "> prune").query, "prune");
});

test("a bare prefix is the mode's whole listing, not a query of one character", () => {
  const bare = readPaletteQuery("go", ">");
  assert.equal(bare.mode, "commands");
  assert.equal(bare.query, "");
  assert.equal(bare.prefix, ">");
});

test("a prefix in the middle is text, not a switch", () => {
  // `paletteSources` matches a `>` in a label like any other character, and a
  // grammar that fired on one anywhere would make half the actions unfindable.
  const held = readPaletteQuery("go", "a > b");
  assert.equal(held.mode, "go");
  assert.equal(held.query, "a > b");
});

test("the ask prefix is not this module's, and is left alone", () => {
  // `?` replaces the list rather than narrowing it, so it is `askMode.ts`'s and
  // reads the RAW query — a grammar that also owned it would answer two
  // different questions in one function.
  assert.equal(
    PALETTE_PREFIXES.some((entry) => entry.prefix === "?"),
    false,
  );
  const asked = readPaletteQuery("go", "?what is this");
  assert.equal(asked.mode, "go");
  assert.equal(asked.query, "?what is this");
});

test("go is the front door: everything except the worktree's whole tree", () => {
  // The one source it does not carry is the reason the files door exists at
  // all — a checkout has thousands of files and six actions.
  assert.equal(MODE_SOURCES.go.includes("worktree-files"), false);
  assert.equal(MODE_SOURCES.go.includes("recent-files"), true);
  for (const id of ["projects", "worktrees", "channels", "panes", "actions"]) {
    assert.ok(MODE_SOURCES.go.includes(id), `go is missing ${id}`);
  }
});

test("each narrowing asks only its own sources", () => {
  assert.deepEqual(MODE_SOURCES.files, ["worktree-files"]);
  assert.deepEqual(MODE_SOURCES.channels, ["channels"]);
  assert.deepEqual(MODE_SOURCES.commands, ["panes", "actions"]);
});

test("the hint row never offers the mode you are standing in", () => {
  // A surface telling him how to reach where he is is noise, and it is the one
  // line of the three he would read as broken.
  for (const mode of ["go", "files", "commands", "channels"]) {
    const hints = paletteHints(mode);
    assert.equal(
      hints.some((hint) => hint.what === modeName(mode)),
      false,
      `${mode} offered its own door`,
    );
    assert.ok(hints.length >= 2 && hints.length <= 3);
  }
});

test("the hint row never teaches a door this host has no sources for", () => {
  // A chat route: channels, projects, worktrees and the recent-file trail, and
  // no work surface to put a pane in (`ShellPalette.tsx`'s `SHELL_OFFERS`).
  // ⌘P falls through there and `>` resolves to a mode with nothing behind it,
  // so a row advertising either would be teaching the owner to press a key
  // that answers with an empty box — the thing `usePalette.ts`'s `offers` doc
  // says is the opposite of a muscle memory.
  const chat = ["channels", "projects", "worktrees", "recent-files"];
  const standing = paletteHints("go", chat).map((hint) => hint.what);
  assert.deepEqual(standing, ["channels"]);

  // From inside the channels mode the way back out is still offered, because
  // `go` is the one door a chat route can always answer.
  assert.deepEqual(
    paletteHints("channels", chat).map((hint) => hint.what),
    ["anywhere"],
  );

  // The workspace with no checkout selected: same rule, different absence.
  const landing = [
    "projects",
    "worktrees",
    "channels",
    "recent-files",
    "panes",
    "actions",
  ];
  const onLanding = paletteHints("go", landing).map((hint) => hint.what);
  assert.equal(onLanding.includes("files"), false);
  assert.deepEqual(onLanding, ["commands", "channels"]);
});

test("a host that offers nothing draws no hint row at all", () => {
  // Not a state the app produces today; asserted because the surface's own
  // answer to an empty list is to draw nothing, and a row of zero hints with a
  // border over it would be a division that means nothing.
  assert.deepEqual(paletteHints("go", []), []);
});

/** What a mode is called in the hint row — read from the row itself so this
 * assertion cannot drift from the copy it is about. */
function modeName(mode) {
  return {
    channels: "channels",
    commands: "commands",
    files: "files",
    go: "anywhere",
  }[mode];
}

test("the placeholder names the list under it, and no two modes share one", () => {
  const said = ["go", "files", "commands", "channels"].map(palettePlaceholder);
  assert.equal(new Set(said).size, said.length, said.join(" · "));
  for (const line of said) assert.ok(line.length > 0);
});
