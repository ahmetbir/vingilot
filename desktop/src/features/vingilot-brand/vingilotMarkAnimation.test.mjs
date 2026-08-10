import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

const sheetPng = readFileSync(here("./mark-animation.png"));
const posterPng = readFileSync(here("./mark-animation-poster.png"));
const animationCss = readFileSync(
  here("./vingilot-mark-animation.css"),
  "utf8",
);
const animationTsx = readFileSync(here("./VingilotMarkAnimation.tsx"), "utf8");

/**
 * PNG IHDR: 8-byte signature, then a chunk whose 8-byte header is followed by
 * width, height, bit depth and colour type. These two files are colour type 3
 * (palette) — one index per pixel into a palette that is white at every entry
 * and carries the mask's alpha in its tRNS chunk, which is half the bytes of
 * the greyscale+alpha form the static mark uses.
 */
function readIhdr(bytes) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colourType: bytes.readUInt8(25),
  };
}

function hasChunk(bytes, name) {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === name) {
      return true;
    }
    offset += length + 12;
  }
  return false;
}

const declared = (name) => {
  const match = animationTsx.match(new RegExp(`${name} = (\\d+)`));
  assert.ok(match, `VingilotMarkAnimation.tsx no longer declares ${name}`);
  return Number(match[1]);
};

/**
 * The frame count is arithmetic, not decoration: the CSS sizes the strip at
 * FRAMES boxes and steps it FRAMES times. A sheet re-derived with a different
 * number of frames, or at a different cell size, would still render — every
 * cell offset by a fraction of itself, the ship sliced across the box, with
 * nothing failing anywhere. This is the only place that can catch it.
 */
test("the declared sheet geometry matches the committed mark-animation.png", () => {
  const { width, height } = readIhdr(sheetPng);
  assert.equal(declared("SAIL_CELL_WIDTH"), width);
  assert.equal(declared("SAIL_CELL_HEIGHT") * declared("SAIL_FRAMES"), height);
});

/**
 * The poster is cell 0 of the same sheet at the same crop, and the gate swaps
 * one for the other mid-boot. If their geometry ever diverged the swap would
 * become a visible jump — the exact thing the poster exists to avoid.
 */
test("the poster is one cell of the sheet, exactly", () => {
  const poster = readIhdr(posterPng);
  assert.equal(poster.width, declared("SAIL_CELL_WIDTH"));
  assert.equal(poster.height, declared("SAIL_CELL_HEIGHT"));
});

/**
 * A mask needs alpha. Both files are palette PNGs, where the alpha lives in
 * tRNS; without that chunk every palette entry is opaque white and the mask
 * covers the whole box, which paints a solid `currentColor` rectangle — read
 * on screen as a bug in the app rather than as a bug in this asset.
 */
test("both assets carry the alpha the mask depends on", () => {
  for (const [name, bytes] of [
    ["mark-animation.png", sheetPng],
    ["mark-animation-poster.png", posterPng],
  ]) {
    const { colourType } = readIhdr(bytes);
    assert.ok(
      colourType === 3 || colourType === 4 || colourType === 6,
      `${name} has PNG colour type ${colourType}, which cannot carry alpha`,
    );
    if (colourType === 3) {
      assert.ok(
        hasChunk(bytes, "tRNS"),
        `${name} is a palette PNG with no tRNS`,
      );
    }
  }
});

/**
 * The theme rule, same as the static mark's: the artwork is a mask over
 * `currentColor` and this file may not pin a colour of its own. The clip is
 * white on black, so every shortcut looks right on the dark theme it is
 * developed against and wrong on the light one.
 */
test("the animation tints from currentColor and never from a literal colour", () => {
  assert.match(animationCss, /background-color:\s*currentColor/);

  const declarations = animationCss
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean);
  const literalColour =
    /(^|[\s:])(#[0-9a-fA-F]{3,8}|white|black|rgb|rgba|hsl|oklch)\b/;
  for (const declaration of declarations) {
    assert.doesNotMatch(
      declaration,
      literalColour,
      `vingilot-mark-animation.css pins a literal colour: "${declaration}"`,
    );
  }
});

/**
 * This asset is fetched on the boot path, before anything else the app does,
 * and it is the one thing here that grows silently: a re-derivation at 24fps
 * or at a larger cell doubles it without a line of code changing. The ceiling
 * is deliberately close to the committed size so that growth is a decision
 * somebody writes down rather than a number nobody looks at.
 */
test("the boot-path assets stay within their byte budget", () => {
  assert.ok(
    sheetPng.length <= 140_000,
    `mark-animation.png is ${sheetPng.length} bytes, over the 140 KB boot budget`,
  );
  assert.ok(
    posterPng.length <= 8_000,
    `mark-animation-poster.png is ${posterPng.length} bytes; it is inlined into the JS bundle`,
  );
});
