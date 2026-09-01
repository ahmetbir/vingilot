// The one control that chooses between a file's source and its rendering — the
// Files viewer's Source⇄Preview toggle
// (owner ask: "markdown preview"; recon 2026-08-13. Widened 2026-09-01 from
// markdown alone to every file that has a rendering — a page, a design, a
// picture — for the owner's "html gosterme, dizayn gosterme, artifact gosterme
// vs hepsi olsun"; renamed from `MarkdownPreviewToggle` with it, because a
// component called "markdown" that a `.png` also uses is a lie in the import
// list).
//
// **One control, one word, three kinds of file.** The label is *Preview* for a
// `.md`, a `.html` and an `.svg` alike, and the only thing that changes between
// them is the noun in the tooltip. That is deliberate: the owner learned this
// control on markdown, and a second control with different words for the same
// gesture would be a second thing to learn for no gain. `renderingNoun`
// (`filePreview.ts`) supplies the noun; nothing here knows what an SVG is.
//
// **It lives in the viewer header, beside `OpenInEditor`, and it is the
// `DiffModeToggle` idiom made concrete for one more pane.** That toggle sits in
// the patch header — title left, meta right, one optional control — and this is
// the same shape one header over: the open file's path on the left, the
// line/size meta on the right, and this control where a control about *this
// file* belongs. `aria-pressed` carries the state and the label never changes,
// for `DiffModeToggle`'s own reason: a control that renames itself flickers, and
// a two-tab segmented control would spend twice the width in a 435px pane.
//
// **Controlled, not self-storing — and that is the one deliberate difference
// from `DiffModeToggle`.** The diff mode is one flag for the whole app (a
// preference about *how he reads diffs*, held once and read by two panes), so it
// reads a module singleton. Preview is the opposite: it is per-pane, so the
// Files pane holds it in React state (`FileViewer`), and this component only
// reflects and reports. Per-pane means two Files panes each remember their own
// choice, the choice survives focus changes because the pane stays mounted, and
// it resets on a community switch because the whole subtree remounts under
// `<AppReady key={communityKey}>` — no module-level store, so nothing to leak
// and nothing to register with `resetCommunityState()`.

const BUTTON_CLASS =
  "shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function PreviewToggle({
  noun,
  onToggle,
  preview,
  testid,
}: {
  /** What this file's rendering IS, as the phrase that follows "Show this file
   * as" — `renderingNoun`'s answer, so the tooltip names the thing he is about
   * to see rather than saying "preview" twice. */
  noun: string;
  onToggle: () => void;
  /** Whether the viewer is currently showing the rendering. The pane owns this
   * bit; this component never stores it. */
  preview: boolean;
  testid: string;
}) {
  return (
    <button
      aria-pressed={preview}
      className={`${BUTTON_CLASS} ${
        preview
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
      data-testid={testid}
      onClick={onToggle}
      title={
        preview ? "Show this file's source again" : `Show this file as ${noun}`
      }
      type="button"
    >
      Preview
    </button>
  );
}
