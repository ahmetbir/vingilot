// The dock's Run tab (redesign P3, mockup `#dp-run`): the Start Dev card,
// real; the services list, honestly empty.
//
// **The card runs the owner's own command, or nothing.** The mockup's card
// says "vite · port 5173" because the mockup's project runs vite; this app
// cannot know what starts a project's dev server, so the command is written
// once per project and remembered (`lib/devCommand.ts`). Start opens a fresh
// terminal tab and TYPES the command into it — the `run-in-new-terminal`
// pane act, landing on the same `pty_write` channel a keystroke uses — so
// the dev server runs where the owner can see it, stop it, and read its
// output: in a shell of his own. No chord: the mockup stamps ⌘R on the card,
// but ⌘R is claimed app-wide by `useReloadShortcut` (webview reload) and
// stealing a working chord for a new card is how muscle memory dies. The
// card says nothing about a key it does not have.
//
// **Services: the mockup's `.svsec`/`.svrow` lists are per-project docker
// compose stacks.** The only compose reader in this app (`vingilot_harbor`)
// is scoped to the app's own home stack — not to the selected project's
// compose file — so a list drawn from it here would be the wrong project's
// truth wearing this one's header. Honest empty state instead; the
// generalized reader is later work.

import * as React from "react";

import {
  persistDevCommand,
  readDevCommand,
} from "@/features/runs/lib/devCommand";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

export function DockRunPanel({ onPaneAct, projectPath }: PaneProps) {
  if (projectPath === null) {
    return (
      <p
        className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-muted-foreground"
        data-testid="dock-run-no-project"
      >
        no project is open here, so there is nothing to start and no compose
        stack to read.
      </p>
    );
  }
  return (
    <RunBody
      key={projectPath}
      onPaneAct={onPaneAct}
      projectPath={projectPath}
    />
  );
}

function RunBody({
  onPaneAct,
  projectPath,
}: {
  onPaneAct: PaneProps["onPaneAct"];
  projectPath: string;
}) {
  const [command, setCommand] = React.useState(
    () => readDevCommand(projectPath) ?? "",
  );

  const runnable = command.trim() !== "";

  const start = () => {
    if (!runnable) return;
    persistDevCommand(projectPath, command);
    onPaneAct({ text: `${command.trim()}\n`, type: "run-in-new-terminal" });
  };

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto"
      data-testid="dock-run"
    >
      {/* The mockup's `.runcard`: round play button, title, sub line. */}
      <div className="mx-3.5 my-3 flex items-center gap-3 rounded-[10px] border border-border/60 bg-foreground/[.02] px-3.5 py-3">
        <button
          aria-label="start the dev command in a new terminal tab"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--vingilot-accent-soft)] text-[var(--vingilot-accent-text)] transition-colors enabled:hover:bg-foreground/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="dock-run-start"
          disabled={!runnable}
          onClick={start}
          title={
            runnable
              ? "Start — opens a terminal tab and types this command into it"
              : "Write the command first — this app will not guess one"
          }
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="currentColor"
            height="14"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Start Dev</div>
          <input
            aria-label="the command that starts this project's dev server"
            // Placeholder at FULL muted strength — an alpha on the muted seed
            // is how four phases failed the pixel measure.
            className="mt-0.5 w-full bg-transparent font-mono text-xs text-muted-foreground placeholder:text-muted-foreground focus:text-foreground focus:outline-none"
            data-testid="dock-run-command"
            onBlur={() => persistDevCommand(projectPath, command)}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") start();
            }}
            placeholder="write the command that starts it — e.g. pnpm dev"
            spellCheck={false}
            value={command}
          />
        </div>
      </div>
      <p className="px-4 text-2xs text-muted-foreground">
        Typed into a fresh terminal tab, visibly — your shell runs it, and its
        tab is where you stop it. Remembered per project.
      </p>
      {/* The mockup's Services sections, as the honest sentence: no
          per-project compose reader exists yet. */}
      <div className="mt-4 border-t border-border/60 px-4 py-3">
        <div className="text-2xs font-semibold uppercase tracking-[.05em] text-muted-foreground">
          Services
        </div>
        <p
          className="mt-1.5 text-xs text-muted-foreground"
          data-testid="dock-run-services-empty"
        >
          No services read for this project yet — the compose reader this app
          ships watches only its own home stack, and showing that here would be
          another project's truth. A per-project reader is later work.
        </p>
      </div>
    </div>
  );
}
