// A pane's empty state, as one designed moment with one shape
// (vingilot/docs/plans/2026-08-12-polish-the-right-side.md, "Empty and loading
// states say something with substance").
//
// The shape: the pane's own registry glyph, dimmed; the model's own
// sentence, unchanged — those words are contracts, pinned by the pane specs;
// one keyboard hint under it, because the hint is the way in for someone who
// does not know the keys yet. Centered in the pane.
//
// **The glyph stays on the workspace's own type scale.** The plan's vocabulary
// said "large", but the island's scale gate (`typeScale.test.mjs`: exactly
// four sizes, written after the owner's "some tiny, some huge") is the
// stronger record of his taste — so the glyph is `text-sm` dimmed, and the
// moment is the centering and the hint, not a poster-sized dingbat.
//
// **Only genuine "nothing chosen yet" states get this.** Waits ("reading…",
// "searching…") and refusals keep their plain left-aligned form: a wait is
// about to be replaced and a refusal is a sentence to be read, and dressing
// either as a moment would make three different facts look like one.

export function PaneEmpty({
  glyph,
  hint,
  sentence,
  testid,
}: {
  /** The pane's registry glyph (`paneRegistry.tsx`'s `icon`) — the same
   * character the picker and the palette print for this pane. */
  glyph: string;
  /** The keyboard way in, or nothing when the pane has none to offer. */
  hint?: string;
  sentence: string;
  testid: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 py-4 text-center"
      data-testid={testid}
    >
      <span aria-hidden="true" className="text-sm text-muted-foreground/40">
        {glyph}
      </span>
      <p className="text-xs text-muted-foreground">{sentence}</p>
      {hint === undefined ? null : (
        <p className="text-2xs text-muted-foreground/70">{hint}</p>
      )}
    </div>
  );
}
