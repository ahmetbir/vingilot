// What a report carries besides its words — its own module, alias-free, so
// `node --test` can read it without the app's path map.

/** What travels with every report so it can be placed without asking: where
 * he was, how big the window was, and which build. Strings only — the drop
 * stores them as they are and the watcher prints them. */
export function reportContext(
  win: Pick<Window, "location" | "innerWidth" | "innerHeight" | "navigator">,
  version: string,
): Record<string, string> {
  return {
    platform: win.navigator.platform,
    route: win.location.hash || win.location.pathname,
    version,
    viewport: `${win.innerWidth}x${win.innerHeight}`,
  };
}
