import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

const markPng = readFileSync(here("./mark.png"));
const markCss = readFileSync(here("./vingilot-mark.css"), "utf8");
const markTsx = readFileSync(here("./VingilotMark.tsx"), "utf8");

/**
 * PNG IHDR: 8-byte signature, then a chunk whose 8-byte header is followed by
 * width, height, bit depth and colour type. Colour type 4 is greyscale+alpha,
 * 6 is truecolour+alpha; both carry the alpha plane a CSS mask needs.
 */
function readIhdr(bytes) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colourType: bytes.readUInt8(25),
  };
}

/**
 * The component declares the mark's proportions as constants because an empty
 * <span> has nothing to size it. Nothing enforces that the declaration matches
 * the file it describes, so a re-derivation at different geometry would render
 * a squashed mark with no error anywhere. This is that enforcement.
 */
test("VingilotMark's declared aspect ratio matches the committed mark.png", () => {
  const { width, height } = readIhdr(markPng);
  const declared = (name) => {
    const match = markTsx.match(new RegExp(`${name} = (\\d+)`));
    assert.ok(match, `VingilotMark.tsx no longer declares ${name}`);
    return Number(match[1]);
  };
  assert.equal(declared("MARK_INTRINSIC_WIDTH"), width);
  assert.equal(declared("MARK_INTRINSIC_HEIGHT"), height);
});

/**
 * A mask needs an alpha channel. An opaque PNG used as a mask-image covers the
 * whole box, which renders as a solid `currentColor` rectangle — and on the
 * dark theme, against a dark surface, that reads as "the mark did not load"
 * rather than as a bug.
 */
test("mark.png carries the alpha channel the mask depends on", () => {
  const { colourType } = readIhdr(markPng);
  assert.ok(
    colourType === 4 || colourType === 6,
    `mark.png has PNG colour type ${colourType}, which has no alpha channel`,
  );
});

/**
 * The theme rule, guarded at the only place it can be broken cheaply. The mark
 * comes from white-on-dark artwork, so every shortcut — painting the PNG as a
 * background-image, hard-coding white, tinting to a literal — looks correct on
 * the dark theme the work is done against and wrong on the light one. The mask
 * must therefore sit over `currentColor` and nothing else.
 */
test("the mark tints from currentColor and never from a literal colour", () => {
  assert.match(markCss, /background-color:\s*currentColor/);

  const declarations = markCss
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
      `vingilot-mark.css pins a literal colour: "${declaration}"`,
    );
  }
});
