import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SELECTION_ALPHA,
  samePalette,
  translucent,
  usableColor,
} from "./terminalPalette.ts";

test("a colour the app actually resolved is kept as it was read", () => {
  assert.equal(usableColor("rgb(30, 30, 46)"), "rgb(30, 30, 46)");
  assert.equal(usableColor("  rgb(30, 30, 46)  "), "rgb(30, 30, 46)");
});

test("a zero blue channel is not transparency", () => {
  // The regression this file exists for. The test used to be a pattern match
  // on the end of the string — `/,\s*0\s*\)$/` — which every opaque colour
  // whose blue channel is 0 also matches. That is not an exotic shape: it is
  // every warm accent (orange, amber, yellow) at full saturation, and
  // `--primary` is the terminal's cursor.
  assert.equal(usableColor("rgb(255, 255, 0)"), "rgb(255, 255, 0)");
  assert.equal(usableColor("rgb(180, 120, 0)"), "rgb(180, 120, 0)");
  assert.equal(usableColor("rgb(255 255 0)"), "rgb(255 255 0)");
});

test("a partly transparent colour is a colour", () => {
  // `bg-primary/30` is the selection background and is meant to be 30%.
  assert.equal(usableColor("rgba(24, 24, 37, 0.3)"), "rgba(24, 24, 37, 0.3)");
  assert.equal(usableColor("rgb(24 24 37 / 30%)"), "rgb(24 24 37 / 30%)");
});

test("a fully transparent answer is no colour at all", () => {
  // What an unresolved token computes to. Handing it to xterm paints that slot
  // in nothing, which reads as an empty shell rather than as a styling bug.
  assert.equal(usableColor("rgba(0, 0, 0, 0)"), null);
  assert.equal(usableColor("rgba(255, 255, 255, 0)"), null);
  assert.equal(usableColor("transparent"), null);
  assert.equal(usableColor(""), null);
  assert.equal(usableColor("   "), null);
});

test("transparency is read off the alpha channel however it is spelled", () => {
  assert.equal(usableColor("rgb(255 255 0 / 0)"), null);
  assert.equal(usableColor("rgb(255 255 0 / 0%)"), null);
  assert.equal(usableColor("rgba(0, 0, 0, 0%)"), null);
  assert.equal(usableColor("color(srgb 1 1 0 / 0)"), null);
  // …and a value with no alpha component is opaque, whatever else it is.
  assert.equal(usableColor("#ffff00"), "#ffff00");
  assert.equal(usableColor("color(srgb 1 1 0)"), "color(srgb 1 1 0)");
});

test("an opaque reading comes back as the rgba xterm can parse", () => {
  // The one spelling that survives xterm 5.5.0's `css.toColor`: its hex and
  // `rgb()`/`rgba()` branches, and then a canvas fallback that throws on
  // anything not fully opaque. A translucent colour that is not literal
  // `rgba(…)` is therefore no colour at all as far as the terminal is
  // concerned.
  assert.equal(translucent("rgb(255, 255, 0)", 0.3), "rgba(255, 255, 0, 0.3)");
  assert.equal(
    translucent("  rgb(30, 30, 46)  ", 0.5),
    "rgba(30, 30, 46, 0.5)",
  );
  assert.equal(translucent("rgb(30 30 46)", 0.3), "rgba(30, 30, 46, 0.3)");
});

test("a colour this cannot take apart is not guessed at", () => {
  // Each of these is a real thing a browser hands back. Answering `null` sends
  // the caller to the unthinned accent, which is legible; inventing a colour
  // out of a shape this does not understand would not be.
  assert.equal(translucent("oklab(0.5 0.1 0.1)", 0.3), null);
  assert.equal(translucent("color(srgb 1 1 0)", 0.3), null);
  assert.equal(translucent("#ffff00", 0.3), null);
  // Already carrying an alpha: re-thinning it would be two opinions about one
  // channel.
  assert.equal(translucent("rgba(255, 255, 0, 0.5)", 0.3), null);
  assert.equal(translucent("rgb(255 255 0 / 50%)", 0.3), null);
});

test("an alpha that is not a thinning is refused", () => {
  // 1 is the colour itself and 0 is no colour at all; neither needs this
  // function, and both would produce a string that says something it does not
  // mean.
  assert.equal(translucent("rgb(255, 255, 0)", 1), null);
  assert.equal(translucent("rgb(255, 255, 0)", 0), null);
  assert.equal(translucent("rgb(255, 255, 0)", Number.NaN), null);
  assert.equal(translucent("rgb(255, 255, 0)", -0.3), null);
  // And the alpha the terminal actually uses is one this accepts.
  assert.notEqual(translucent("rgb(255, 255, 0)", SELECTION_ALPHA), null);
});

test("two readings of the same palette are the same reading", () => {
  const palette = {
    background: "rgb(30, 30, 46)",
    cursor: "rgb(255, 255, 0)",
    cursorAccent: "rgb(30, 30, 46)",
    foreground: "rgb(205, 214, 244)",
    selectionBackground: "rgba(255, 255, 0, 0.3)",
  };
  assert.equal(samePalette(palette, { ...palette }), true);
});

test("a palette that changed in any one slot is a different palette", () => {
  const palette = {
    background: "rgb(30, 30, 46)",
    cursor: "rgb(255, 255, 0)",
    cursorAccent: "rgb(30, 30, 46)",
    foreground: "rgb(205, 214, 244)",
    selectionBackground: "rgba(255, 255, 0, 0.3)",
  };
  for (const slot of [
    "background",
    "cursor",
    "cursorAccent",
    "foreground",
    "selectionBackground",
  ]) {
    assert.equal(
      samePalette(palette, { ...palette, [slot]: "rgb(1, 2, 3)" }),
      false,
      `${slot} changed and the palette still read as unchanged`,
    );
    // A slot that stopped resolving is a change too — that is the terminal
    // falling back to xterm's own default for it.
    assert.equal(
      samePalette(palette, { ...palette, [slot]: undefined }),
      false,
      `${slot} stopped resolving and the palette still read as unchanged`,
    );
  }
});
