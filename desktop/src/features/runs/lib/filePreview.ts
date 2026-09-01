// What a file can be LOOKED AT as, and the posture a page from a worktree is
// looked at under
// (owner ask: "html gosterme, dizayn gosterme, artifact gosterme vs hepsi
// olsun" — when the work in a worktree produces a page, a design or an image,
// he wants to see the thing rather than its source).
//
// **This is the second half of a vocabulary that already exists, not a new
// one.** `fileViewer.ts`'s `previewableAsMarkdown` is the first: it answers
// "may this file be read as prose rather than as its source", and the control
// that acts on it says *Preview*. Nothing here renames that. `fileRendering`
// is the same question asked of three more kinds of file, and the answers ride
// the same toggle, in the same word.
//
// **A rendering belongs to the PATH, not to the read.** That is what lets the
// viewer decide whether to offer a toggle before any bytes have arrived, and it
// is why a `.png` — which `file_read` refuses as binary, correctly — is still a
// file with a rendering. The rendering says where its pixels come from
// (`from: "bytes"`, a second read) rather than assuming they are in the text.
//
// **"Artifact" is already a word in this app and it is NOT this word.**
// `PinnedCard.tsx`'s `Artifact` is a run's produced work as git reports it —
// the commit sha and its +N/-M. It has no visual form and nothing here is an
// instance of it. So the owner's "artifact gosterme" is served by the same
// three renderings below, and no fourth noun is invented for it.

import { previewableAsMarkdown } from "@/features/runs/lib/fileViewer";

/** Where a picture's pixels come from, and what kind of picture it is.
 *
 * `from` is the whole reason this is a union rather than a boolean: an `.svg`
 * is text the viewer already has, and a `.png` is bytes nobody has read yet.
 * Two different reads, one rendering. */
export type FileRendering =
  | { look: "markdown" }
  | { look: "html" }
  | { look: "image"; mime: string; from: "text" | "bytes" };

/** Raster pictures, extension → the media type a `data:` URL has to carry.
 *
 * Short on purpose, and every row is a type WebKit decodes without a plugin.
 * An extension not named here has no rendering, which is an answer — the file
 * opens as whatever `file_read` makes of it, and says so in its own words. */
const RASTER: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // A leading dot is a dotfile's dot rather than an extension's — the rule
  // `languageOf` already applies, kept in step.
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** What this file can be looked at as, or `null` when it can only be read.
 *
 * `null` is the common answer and it is a real one: a `.rs` has no rendering,
 * so it gets no toggle at all rather than a disabled one.
 *
 * `.svg` is an image here and never markup, and that is a security decision
 * rather than a rendering one: an SVG is a script vector as well as a picture
 * (`<script>`, `onload`, `<foreignObject>`), and everything in it goes inert the
 * moment it is the `src` of an `<img>` — image documents run no script and issue
 * no subresource loads. Inlining the same bytes into the app's DOM would run
 * every one of them with the app's own privileges. */
export function fileRendering(path: string): FileRendering | null {
  // Markdown's gate is `fileViewer.ts`'s and stays there — `.md` yes, `.mdx`
  // no, because the chat pipeline renders CommonMark+GFM and MDX's JSX is not
  // that. Called rather than restated: a second copy of that rule would be a
  // second answer the day one of them is edited, and `fileViewer.test.mjs`
  // already owns its cases.
  if (previewableAsMarkdown(path)) return { look: "markdown" };
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm"))
    return { look: "html" };
  if (lower.endsWith(".svg")) {
    return { from: "text", look: "image", mime: "image/svg+xml" };
  }
  const mime = RASTER[extensionOf(path)];
  if (mime === undefined) return null;
  return { from: "bytes", look: "image", mime };
}

/** How the toggle names this rendering in its tooltip, as the phrase that
 * follows "Show this file as" — so one control says the right thing about three
 * kinds of file without ever changing its label.
 *
 * The article is part of the phrase because "prose" is a mass noun and "page"
 * is not, and a tooltip reading "as a prose" is a tooltip nobody wrote on
 * purpose. */
export function renderingNoun(rendering: FileRendering): string {
  if (rendering.look === "markdown") return "prose";
  if (rendering.look === "html") return "a sandboxed page";
  return "a picture";
}

/** The `sandbox` attribute a worktree's page is rendered under.
 *
 * **The empty string, which is every restriction on.** No `allow-same-origin`
 * (the frame gets an opaque origin, so it cannot reach this document, its
 * `localStorage`, its cookies or the Tauri bridge hanging off its `window`), no
 * `allow-scripts`, no `allow-forms`, no `allow-popups`, no
 * `allow-top-navigation`, no `allow-modals`.
 *
 * **`allow-scripts` and `allow-same-origin` are never both present**, which is
 * the one combination that is not a sandbox at all: together they let the framed
 * document reach up and remove its own `sandbox` attribute. Here neither is
 * present, so the pair cannot arise.
 *
 * **There is no opt-in that turns scripts on, and that is a choice rather than
 * a limit.** `file-preview.spec.ts` builds exactly the frame such an opt-in
 * would need — this document with `allow-scripts` and `script-src
 * 'unsafe-inline'` — and the script runs in it, so the control is buildable and
 * nothing here should be read as claiming otherwise. It is not shipped because
 * of what that spec ALSO shows: with the script live, all five of its reaches
 * are refused by the remaining layers, so the honest label on such a toggle
 * would be "run this page's script, which still cannot reach anything" — a
 * risk taken for a benefit that is hard to name. A page whose carousel does not
 * move is explained by `PREVIEW_SANDBOX_NOTE`; a page that needs its script to
 * be *read* is a page for a browser. If it is ever wanted, the ask is a
 * per-file bit (never a remembered preference), off by default, and a sentence
 * naming the risk in the UI's own words — not a change to this constant. */
export const PREVIEW_SANDBOX = "";

/** The policy the framed document is served under, injected as the first thing
 * its parser sees.
 *
 * **Belt as well as braces, and the braces are load-bearing.** `sandbox=""`
 * already stops script, but it does not stop a *passive* remote load — an
 * `<img src="https://tracker/pixel.png">`, a `<link rel=stylesheet>`, a web font
 * — and every one of those is a page from an untrusted worktree telling someone
 * else that the owner opened it. `default-src 'none'` ends all of them.
 *
 * `img-src data:` and not `'self'`: a sandboxed document's origin is opaque, so
 * `'self'` matches nothing, and a relative `<img src="logo.png">` in a `srcdoc`
 * document resolves against THIS app's URL rather than against the worktree.
 * Only what the page carries inline can draw.
 *
 * `style-src 'unsafe-inline'` is the one permission granted, and it is what
 * makes the preview worth having: a design is its CSS. Inline `<style>` and
 * `style=` attributes paint; an external stylesheet still cannot load.
 *
 * `base-uri 'none'` so the page cannot re-point relative URLs at a host of its
 * choosing, and `form-action 'none'` so a form has nowhere to post even if the
 * sandbox that already forbids submission were lifted. */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "style-src 'unsafe-inline'",
].join("; ");

/** What is switched off, said on the screen it is switched off on.
 *
 * **A page that looks broken has to be explained rather than mysterious.** A
 * design whose web font never arrives, whose analytics beacon never fires and
 * whose carousel never moves is not a bug in this pane and not a bug in the
 * page — it is this sentence, working. Without it the honest reading of a blank
 * area is "the preview is broken", and the next thing he does is stop trusting
 * the pane. */
export const PREVIEW_SANDBOX_NOTE =
  "Sandboxed: scripts, forms and network are off, and nothing outside this file loads — a page here draws only itself.";

/** The document the frame is handed: the file's own HTML with a policy in
 * front of it.
 *
 * **The policy goes first because the parser is sequential.** A `<meta>` CSP
 * takes effect for everything after it, so it is emitted before one byte of the
 * file — any `<html>`/`<head>` the file opens afterwards is merged into the head
 * the parser has already begun. A page cannot loosen this by declaring its own
 * policy either: CSP composes, and two policies both have to allow a load. */
export function sandboxedDocument(html: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${html}`;
}

/** An `<img>` source for a picture the viewer already holds as text.
 *
 * Percent-encoded rather than base64 — `btoa` throws on any code point above
 * U+00FF, and an SVG with a Turkish `ş` in a `<text>` element is an ordinary
 * SVG. `#` and `&` in particular MUST be encoded: a raw `#` would truncate the
 * URL at the first fill colour. */
export function textImageSource(mime: string, text: string): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
}

/** An `<img>` source for a picture that arrived as bytes. */
export function bytesImageSource(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

/** **Its own sentence, because it is its own failure.** The three bounds
 * `filesRefusal` speaks for are all refusals to *read*: too large, binary,
 * gone. This one is the opposite — the bytes arrived whole and the decoder
 * turned them down — so folding it into "could not be read" would name the
 * wrong thing and point at the wrong next action. The next action here is to
 * doubt the file, not the pane. */
export function pictureRefusal(path: string, mime: string): string {
  return `${path} was read whole, but no picture came out of it — the bytes are not ${mime} this webview can decode.`;
}
