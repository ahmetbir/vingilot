// Two things about the palette's chrome that no rendered assertion reaches and
// no type checks (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 3).
//
// `paletteModel`'s tests say what the list computes and
// `workspace-palette.spec.ts` says what a browser draws. What is left is a pair
// of properties of the *source*: that a kind cannot arrive without a mark of
// its own, and that nothing in this surface animates its way in.
//
// Read as text, like `typeScale.test.mjs`: the component is TSX and a
// `node --test` run cannot load JSX.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const featureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relative) {
  return readFileSync(path.join(featureRoot, relative), "utf8");
}

test("every kind of row has a mark, and no two kinds share one", () => {
  // A `Record<PaletteKind, LucideIcon>` already makes a missing kind a compile
  // error. What the type cannot say is that the four marks are four different
  // marks — and two kinds drawing the same glyph is precisely the surface this
  // task was given: rows whose kind you had to read the label to learn.
  const kinds = /export type PaletteKind =([^;]*);/.exec(
    read("lib/paletteModel.ts"),
  );
  assert.notEqual(kinds, null, "PaletteKind is no longer declared as a union");
  const declared = [...kinds[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, "PaletteKind parsed as empty");

  const table =
    /const KIND_ICON: Record<PaletteKind, LucideIcon> = \{([^}]*)\}/.exec(
      read("ui/CommandPalette.tsx"),
    );
  assert.notEqual(table, null, "the palette no longer maps a kind to an icon");
  const mapped = new Map(
    [...table[1].matchAll(/(\w+):\s*(\w+),/g)].map((m) => [m[1], m[2]]),
  );

  assert.deepEqual([...mapped.keys()].sort(), [...declared].sort());
  const marks = [...mapped.values()];
  assert.equal(
    new Set(marks).size,
    marks.length,
    `two kinds share a mark: ${marks.join(", ")}`,
  );
});

test("the palette does not animate its way in", () => {
  // It is the surface the owner reaches for most and he types into it before
  // he looks at it. An enter animation — `animate-in`, an opacity ramp, a
  // transform — is a window in which the field is on screen and the first
  // keystroke is not in it. The colour transitions on a row's own hover and
  // cursor states are not that: they run on a surface that has already
  // arrived, and only after something moves.
  const text = read("ui/CommandPalette.tsx");
  const found = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const match of line.matchAll(
      /\b(animate-[\w.[\]/-]+|transition(?:-\w+)?|duration-[\w.[\]/-]+|ease-[\w.[\]/-]+)\b/g,
    )) {
      if (
        match[0] !== "transition-colors" &&
        !line.trimStart().startsWith("//")
      ) {
        found.push(`ui/CommandPalette.tsx:${index + 1}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(found, []);
});
