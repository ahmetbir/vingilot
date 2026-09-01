import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bytesImageSource,
  fileRendering,
  PREVIEW_CSP,
  PREVIEW_SANDBOX,
  PREVIEW_SANDBOX_NOTE,
  pictureRefusal,
  renderingNoun,
  sandboxedDocument,
  textImageSource,
} from "./filePreview.ts";

test("a file with a rendering says which one, and where its pixels are", () => {
  assert.deepEqual(fileRendering("docs/notes.md"), { look: "markdown" });
  assert.deepEqual(fileRendering("out/report.html"), { look: "html" });
  assert.deepEqual(fileRendering("out/report.HTM"), { look: "html" });
  // An SVG is text the viewer already holds — no second read.
  assert.deepEqual(fileRendering("brand/mark.svg"), {
    from: "text",
    look: "image",
    mime: "image/svg+xml",
  });
  // A raster is bytes nobody has read yet, which is what `from` is for.
  assert.deepEqual(fileRendering("shots/home.PNG"), {
    from: "bytes",
    look: "image",
    mime: "image/png",
  });
  assert.deepEqual(fileRendering("a/b/photo.jpeg"), {
    from: "bytes",
    look: "image",
    mime: "image/jpeg",
  });
});

test("a file with no rendering says so, so no toggle is drawn at all", () => {
  // The whole point of `null`: the control is ABSENT for these, never disabled.
  assert.equal(fileRendering("src/main.rs"), null);
  assert.equal(fileRendering("Cargo.toml"), null);
  assert.equal(fileRendering("build/app.wasm"), null);
  // `.mdx` is markdown's own excluded case and it stays excluded here —
  // `previewableAsMarkdown` owns that rule and this asks it rather than
  // restating it.
  assert.equal(fileRendering("docs/guide.mdx"), null);
  // A dotfile's leading dot is not an extension: `.png` as a whole filename is
  // a dotfile, not a picture.
  assert.equal(fileRendering(".png"), null);
  assert.equal(fileRendering("README"), null);
});

test("one control, one word, three nouns", () => {
  // The label stays "Preview" for all three; only the tooltip's noun moves,
  // and each reads as English after "Show this file as".
  assert.equal(renderingNoun({ look: "markdown" }), "prose");
  assert.equal(renderingNoun({ look: "html" }), "a sandboxed page");
  assert.equal(
    renderingNoun({ from: "bytes", look: "image", mime: "image/png" }),
    "a picture",
  );
});

test("the sandbox is every restriction on, and never the one unsafe pair", () => {
  // The empty string IS the strictest sandbox. The pair that is not a sandbox
  // at all — `allow-scripts` with `allow-same-origin`, which lets the framed
  // document remove its own attribute — cannot arise, because neither token is
  // here.
  assert.equal(PREVIEW_SANDBOX, "");
  assert.ok(!PREVIEW_SANDBOX.includes("allow-scripts"));
  assert.ok(!PREVIEW_SANDBOX.includes("allow-same-origin"));
});

test("the policy forbids every load that would leave this machine", () => {
  assert.ok(PREVIEW_CSP.includes("default-src 'none'"));
  assert.ok(PREVIEW_CSP.includes("script-src 'none'"));
  assert.ok(PREVIEW_CSP.includes("connect-src 'none'"));
  assert.ok(PREVIEW_CSP.includes("form-action 'none'"));
  assert.ok(PREVIEW_CSP.includes("base-uri 'none'"));
  // Only what the page carries inline may draw or paint. `'self'` would be
  // meaningless (a sandboxed document's origin is opaque) and a host source
  // would be the remote load this whole policy exists to stop.
  assert.equal(PREVIEW_CSP.includes("img-src data:"), true);
  assert.equal(PREVIEW_CSP.includes("style-src 'unsafe-inline'"), true);
  assert.ok(!/https?:/.test(PREVIEW_CSP));
  assert.ok(!PREVIEW_CSP.includes("'unsafe-eval'"));
  // No double quote anywhere: the policy is interpolated into a double-quoted
  // HTML attribute, and one would end it early and unbolt the whole thing.
  assert.ok(!PREVIEW_CSP.includes('"'));
});

test("the policy is the first thing the parser sees, before one byte of the file", () => {
  const framed = sandboxedDocument(
    '<html><body><img src="x.png"></body></html>',
  );
  // Everything the page brought comes AFTER the meta, which is what makes the
  // policy apply to it — a parser is sequential and a policy declared late is
  // a policy that missed the loads above it.
  const meta = framed.indexOf("Content-Security-Policy");
  const page = framed.indexOf("<html>");
  assert.ok(meta > 0);
  assert.ok(meta < page);
  assert.ok(framed.startsWith("<!doctype html>"));
  assert.ok(framed.includes(PREVIEW_CSP));
  // The file's own bytes are passed through untouched — this is a preview, not
  // a rewriter, and a page silently edited on the way to the screen would not
  // be the page he wrote.
  assert.ok(framed.endsWith('<html><body><img src="x.png"></body></html>'));
});

test("what is switched off is said in words, so a broken-looking page is explained", () => {
  assert.match(PREVIEW_SANDBOX_NOTE, /scripts/);
  assert.match(PREVIEW_SANDBOX_NOTE, /network/);
});

test("a text picture is percent-encoded, because base64 cannot hold every SVG", () => {
  // `btoa` throws above U+00FF, and an SVG with a Turkish ş in it is an
  // ordinary SVG. `#` in particular MUST be encoded — a raw one would truncate
  // the URL at the first fill colour.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><text fill="#ff0">ş</text></svg>';
  const source = textImageSource("image/svg+xml", svg);
  assert.ok(source.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.ok(!source.includes("#"));
  assert.equal(
    decodeURIComponent(
      source.slice("data:image/svg+xml;charset=utf-8,".length),
    ),
    svg,
  );
});

test("a bytes picture carries its own media type", () => {
  assert.equal(
    bytesImageSource("image/png", "iVBORw0KGgo="),
    "data:image/png;base64,iVBORw0KGgo=",
  );
});

test("a picture that will not decode gets its own sentence, not a read's", () => {
  // The read's refusals are all "this could not be read". This one is the
  // opposite — read whole, turned down by the decoder — so it names the file,
  // the type it claimed to be, and nothing about reading.
  const said = pictureRefusal("shots/home.png", "image/png");
  assert.match(said, /shots\/home\.png/);
  assert.match(said, /image\/png/);
  assert.match(said, /read whole/);
  assert.ok(!said.includes("could not be read"));
});
