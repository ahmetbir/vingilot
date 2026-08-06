// The Runs screen's leftmost column: pick a project (a repo from Workspace
// state, see projects.ts's `readRepos`) or fall back to the project-less
// landing view (the Deck). Mirrors RunList's "+ New run" row style — this
// replaces RunList as the screen's front door; RunList itself moves into
// WorkSurface's Runs tab (see vingilot/docs/plans/2026-08-06-projects-and-terminal.md).

import type { Repo } from "@/features/runs/lib/projects";

interface ProjectsNavProps {
  repos: Repo[];
  /** `null` when on the project-less landing view. */
  selectedRepoId: string | null;
  onSelectRepo: (id: string) => void;
  onSelectLanding: () => void;
}

export function ProjectsNav({
  onSelectLanding,
  onSelectRepo,
  repos,
  selectedRepoId,
}: ProjectsNavProps) {
  return (
    <div
      className="flex min-h-0 w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/60 px-2 py-3"
      data-testid="projects-nav"
    >
      <button
        className={`rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors ${
          selectedRepoId === null
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted/60"
        }`}
        data-testid="projects-nav-landing"
        onClick={onSelectLanding}
        type="button"
      >
        Runs
      </button>

      <h2 className="mt-2 flex items-center gap-1.5 px-2 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Projects
        <span className="text-muted-foreground/60">{repos.length}</span>
      </h2>

      {repos.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          no projects yet
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {repos.map((repo) => (
            <li key={repo.id}>
              <button
                className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                  repo.id === selectedRepoId
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
                data-testid={`projects-nav-repo-${repo.id}`}
                onClick={() => onSelectRepo(repo.id)}
                type="button"
              >
                {repo.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
