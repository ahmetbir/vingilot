// The Diff pane's picker: what to read this worktree against, without
// having to know git's spelling for it (2026-09-04).
//
// The free box beside it stays for anything not listed — a SHA, a tag,
// `A...B` by hand. This lists what git answered for this checkout
// (`worktree_refs`) as rows the owner would recognise: uncommitted, since it
// left main, against main outright, and every branch as "since it left
// that". Choosing a row reads at once; there is no second press.

import { ChevronDown } from "lucide-react";
import * as React from "react";

import {
  type BaseChoice,
  type BaseChoices,
  baseChoices,
} from "@/features/runs/lib/diffBase";
import type { Worktree } from "@/features/runs/lib/projects";
import { gitWorktreeRefs } from "@/features/runs/lib/worktreeClient";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

export interface DiffBasePickerProps {
  cwd: string | null;
  worktree: Worktree;
  current: string;
  onChoose: (base: string) => void;
}

const ROW =
  "flex w-full flex-col items-start rounded px-2 py-1 text-left hover:bg-foreground/[.06] focus-visible:outline-none focus-visible:bg-foreground/[.08]";

function Rows({
  choices,
  current,
  onChoose,
  testid,
  title,
}: {
  choices: BaseChoice[];
  current: string;
  onChoose: (base: string) => void;
  testid: string;
  title: string;
}) {
  if (choices.length === 0) return null;
  return (
    <div className="mb-1">
      <div className="px-2 pb-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {choices.map((c) => (
        <button
          aria-current={c.base === current ? "true" : undefined}
          className={ROW}
          data-testid={`${testid}-${c.base}`}
          key={c.base}
          onClick={() => onChoose(c.base)}
          type="button"
        >
          <span className="text-sm">{c.label}</span>
          <span className="text-2xs text-muted-foreground">{c.detail}</span>
        </button>
      ))}
    </div>
  );
}

export function DiffBasePicker({
  current,
  cwd,
  onChoose,
  worktree,
}: DiffBasePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [choices, setChoices] = React.useState<BaseChoices | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  // Asked when opened, not on mount: a pane that is never opened costs git
  // nothing, and branches change under a session.
  React.useEffect(() => {
    if (!open || cwd === null) return;
    let alive = true;
    void gitWorktreeRefs(cwd).then((result) => {
      if (!alive) return;
      if (result.ok) {
        setChoices(baseChoices(result.value, worktree));
        setRefusal(null);
      } else {
        setChoices(
          baseChoices(
            { defaultBranch: null, head: null, local: [], remote: [] },
            worktree,
          ),
        );
        setRefusal(explainWorktreeError(result.error).message);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, cwd, worktree]);

  const q = query.trim().toLowerCase();
  const filter = (rows: BaseChoice[]) =>
    q === ""
      ? rows
      : rows.filter(
          (r) =>
            r.label.toLowerCase().includes(q) ||
            r.base.toLowerCase().includes(q),
        );
  const choose = (base: string) => {
    setOpen(false);
    setQuery("");
    onChoose(base);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label="Choose what to read this worktree against"
          className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          data-testid="worktree-diff-pick"
          disabled={cwd === null}
          type="button"
        >
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-1.5"
        data-testid="worktree-diff-pick-list"
      >
        <Input
          aria-label="Filter branches"
          autoFocus
          className="mb-1.5 h-8"
          data-testid="worktree-diff-pick-filter"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter branches…"
          value={query}
        />
        {choices === null ? (
          <div className="px-2 py-1 text-sm text-muted-foreground">
            asking git…
          </div>
        ) : (
          <>
            <Rows
              choices={filter(choices.quick)}
              current={current}
              onChoose={choose}
              testid="diff-base-quick"
              title="Read"
            />
            <Rows
              choices={filter(choices.local)}
              current={current}
              onChoose={choose}
              testid="diff-base-local"
              title="Since it left a branch"
            />
            <Rows
              choices={filter(choices.remote)}
              current={current}
              onChoose={choose}
              testid="diff-base-remote"
              title="Since it left a remote branch"
            />
          </>
        )}
        {refusal === null ? null : (
          <div
            className="px-2 py-1 text-2xs text-destructive"
            data-testid="worktree-diff-pick-refusal"
          >
            git refused: {refusal}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
