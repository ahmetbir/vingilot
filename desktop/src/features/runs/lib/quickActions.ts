// Quick Actions — the status bar's configurable canned prompts (redesign P4,
// mockup `.sbtn`: Vingilot.html:333). The owner's own feature, verbatim:
// "these can be ready-made prompts, configurable from Settings, that type
// into tmux and press Enter automatically. Except Review."
//
// Two declared exceptions live OUTSIDE this module, on purpose:
// - **Review** dispatches to an agent instead of typing
//   (`reviewDispatch.ts`/`useReviewDispatch.ts`, `StatusBarReviewPopover.tsx`)
//   and never reads this file.
// - **Stop** keeps the app's existing real stop-run behavior
//   (`StopAllButton`) rather than becoming a prompt — see
//   `StatusBarQuickActions.tsx` for why a typed "please stop" would be less
//   honest than the button that already does the real thing. It is therefore
//   not one of the buttons this module models either.
//
// So this file holds exactly the mockup's other two defaults (Commit, Create
// PR) and the small template vocabulary a button's prompt may use — filled
// ONLY from real state, never invented (the phase's standing rule).
//
// Pure: no React, no Tauri, no storage — `vingilot-quick-actions.ts` owns
// persistence, `StatusBarQuickActions.tsx` owns pressing one.

import { worktreeSummary, type Worktree } from "./projects.ts";

export interface QuickActionButton {
  id: string;
  label: string;
  promptTemplate: string;
}

/** The variables a prompt template may reference. Each is fed from state a
 * real worktree actually carries — never a guess. */
export const QUICK_ACTION_TEMPLATE_VARS = [
  "branch",
  "worktree_path",
  "diff_summary",
] as const;
export type QuickActionTemplateVar =
  (typeof QUICK_ACTION_TEMPLATE_VARS)[number];

export type QuickActionVars = Record<QuickActionTemplateVar, string | null>;

export const DEFAULT_QUICK_ACTIONS: readonly QuickActionButton[] = [
  {
    id: "commit",
    label: "Commit",
    promptTemplate:
      "Commit the changes on this worktree with a clear commit message.",
  },
  {
    id: "create-pr",
    label: "Create PR",
    promptTemplate: "Push this branch and open a pull request for {{branch}}.",
  },
];

/** Fill a template's `{{var}}` placeholders from real state. A variable this
 * worktree has no value for renders as "" — never the literal placeholder,
 * and never a guessed value standing in for one. An unknown `{{name}}` (a
 * hand-edited template, or a future rename) is left untouched rather than
 * blanked, so a typo reads as a typo instead of silently vanishing. */
export function renderQuickActionPrompt(
  template: string,
  vars: QuickActionVars,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
    if (!(QUICK_ACTION_TEMPLATE_VARS as readonly string[]).includes(name)) {
      return whole;
    }
    return vars[name as QuickActionTemplateVar] ?? "";
  });
}

/** The template vars for one worktree — `worktreeSummary`'s own honesty rule
 * carried through: a diff with no evidence yet renders `null` (never "+0
 * −0", which would claim a fact nobody has read), and a real all-clean diff
 * says so in words rather than a zero that reads as "no data". */
export function quickActionVarsForWorktree(
  worktree: Worktree | null,
  cwd: string | null,
): QuickActionVars {
  if (worktree === null) {
    return { branch: null, diff_summary: null, worktree_path: cwd };
  }
  const summary = worktreeSummary(worktree);
  const diffSummary =
    summary.diff === null
      ? null
      : summary.diff.added === 0 && summary.diff.removed === 0
        ? "no changes"
        : `+${summary.diff.added} −${summary.diff.removed}`;
  return {
    branch: summary.label,
    diff_summary: diffSummary,
    worktree_path: cwd,
  };
}

function isQuickActionButton(value: unknown): value is QuickActionButton {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.label === "string" &&
    v.label !== "" &&
    typeof v.promptTemplate === "string"
  );
}

/** Tolerant read of a stored button list: anything not well-formed is
 * dropped, never thrown on — the same rule `projects.ts`'s `readRepos` keeps,
 * for the same reason (a stored value crosses a boundary this app does not
 * fully trust). An empty array is a real, distinct answer (the owner removed
 * every button) and is returned as such rather than coerced to the
 * defaults — `vingilot-quick-actions.ts` decides what "nothing stored yet"
 * means; this function only decides what "not a button" means. */
export function readQuickActionsList(raw: unknown): QuickActionButton[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isQuickActionButton);
}

/** A fresh id for a button the Settings card creates. Not derived from the
 * label: two buttons may share a label while editing, and an id must not. */
export function newQuickActionId(): string {
  return `qa-${Math.random().toString(36).slice(2, 10)}`;
}
