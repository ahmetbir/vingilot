// **The mockup's three little chips, shared by the row and the detail**
// (`vingilot.css` `.brchip`, `.prlabel`, and the diffstat the row carries in
// place of the mockup's `.prright`).
//
// `.brchip` is monospace on a cool tint (`#9fc6d6` on `rgba(127,178,201,.12)`)
// and `.prlabel` is a pill; both are taken to the app's two-theme ramp for the
// reason `pullsGlyphs.tsx` gives.
//
// **The diffstat is here because the mockup's right rail is not.** `.prright`
// draws a CI tick, a comment count and reviewer avatars — a check run, a
// comment total and a reviewer list, none of which `payload::Pull` carries.
// Drawing that rail would mean inventing all three. What the island *does* send
// for every row is `additions`, `deletions` and `changedFiles`, so the row
// spends the same space on those.

/** A branch name, the mockup's `.brchip`. */
export function BranchChip({ name }: { name: string }) {
  if (name === "") return null;
  return (
    <span className="rounded-[5px] bg-sky-500/10 px-1.5 py-px font-mono text-badge text-sky-700 dark:text-sky-300">
      {name}
    </span>
  );
}

/** GitHub's own labels, the mockup's `.prlabel`. The mockup tints each label
 * with its own colour; the island sends label *names* only (`payload::Pull`'s
 * `labels: Vec<String>`), so every chip takes one neutral tint rather than a
 * colour this build would have to make up. */
export function LabelChips({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((label) => (
        <span
          className="rounded-[9px] bg-foreground/[0.07] px-2 py-px text-badge font-semibold text-muted-foreground"
          data-testid="pull-label"
          key={label}
        >
          {label}
        </span>
      ))}
    </>
  );
}

/** `+338 −63 · 8 files`, from the three counts the island sends. */
export function DiffStat({
  additions,
  changedFiles,
  deletions,
}: {
  additions: number;
  changedFiles: number;
  deletions: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-badge"
      data-testid="pull-diffstat"
    >
      <span className="text-emerald-600 dark:text-emerald-400">
        +{additions}
      </span>
      <span className="text-rose-600 dark:text-rose-400">−{deletions}</span>
      <span className="text-muted-foreground">
        {changedFiles === 1 ? "1 file" : `${changedFiles} files`}
      </span>
    </span>
  );
}
