// What a diff can be read against, as rows a picker draws (2026-09-04):
// the owner's "main ile worktree difi vs. configurable bisi istiyom".
//
// **The diff needs no new vocabulary.** `git diff <base> --` already takes
// any revision expression, and `A...B` — the merge-base form — is exactly
// "what B changed since it left A". So a row here is a string the existing
// read understands, and the picker is a way to reach the strings he would
// otherwise have to type. The free box stays beside it for the rest.
//
// Pure: given what git listed (`worktreeRefs`) and the worktree, the rows.

import { defaultDiffBase } from "./worktreeDiff.ts";
import type { Worktree } from "./projects.ts";

export interface WorktreeRefs {
  head: string | null;
  defaultBranch: string | null;
  local: string[];
  remote: string[];
}

export interface BaseChoice {
  /** The revision expression handed to `git diff`. */
  base: string;
  label: string;
  /** One line under the label, in the terms of the question it answers. */
  detail: string;
}

export interface BaseChoices {
  /** The handful worth a row of their own, first. */
  quick: BaseChoice[];
  local: BaseChoice[];
  remote: BaseChoice[];
}

/** Tolerant read of what `worktree_refs` answered: a shape this build cannot
 * read is "git listed nothing", which the picker draws as no branch rows and
 * never as a throw over the Diff pane. */
export function readWorktreeRefs(value: unknown): WorktreeRefs {
  const none: WorktreeRefs = {
    defaultBranch: null,
    head: null,
    local: [],
    remote: [],
  };
  if (typeof value !== "object" || value === null) return none;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): string[] =>
    Array.isArray(x)
      ? x.filter((s): s is string => typeof s === "string" && s !== "")
      : [];
  return {
    defaultBranch:
      typeof v.defaultBranch === "string" && v.defaultBranch !== ""
        ? v.defaultBranch
        : null,
    head: typeof v.head === "string" && v.head !== "" ? v.head : null,
    local: strings(v.local),
    remote: strings(v.remote),
  };
}

/** "Since it left `main`" — the merge-base form, so commits main gained
 * meanwhile are not counted against this branch. */
export function sinceBranchPoint(branch: string): string {
  return `${branch}...HEAD`;
}

export function baseChoices(
  refs: WorktreeRefs,
  worktree: Worktree,
): BaseChoices {
  const quick: BaseChoice[] = [
    {
      base: "HEAD",
      detail: "what is changed and not committed",
      label: "Uncommitted",
    },
  ];
  const fallback = defaultDiffBase(worktree);
  if (fallback !== "HEAD") {
    quick.push({
      base: fallback,
      detail: "everything since the run branched, committed or not",
      label: `Since ${fallback.slice(0, 7)}`,
    });
  }
  const main = refs.defaultBranch;
  if (main !== null && main !== refs.head) {
    quick.push({
      base: sinceBranchPoint(main),
      detail: `commits on this branch that ${main} does not have`,
      label: `Since it left ${main}`,
    });
    quick.push({
      base: main,
      detail: `the working tree against ${main}, uncommitted included`,
      label: `Against ${main}`,
    });
    const remote = `origin/${main}`;
    if (refs.remote.includes(remote)) {
      quick.push({
        base: sinceBranchPoint(remote),
        detail: `commits here that ${remote} does not have — what a pull request would carry`,
        label: `Since it left ${remote}`,
      });
    }
  }
  const row = (name: string): BaseChoice => ({
    base: sinceBranchPoint(name),
    detail: `commits here since it left ${name}`,
    label: name,
  });
  return {
    local: refs.local.filter((b) => b !== refs.head).map(row),
    quick,
    remote: refs.remote.map(row),
  };
}
