import * as React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import {
  getSingletonHighlighter,
  type HighlighterGeneric,
  type BundledLanguage,
  type BundledTheme,
  type ThemedToken,
} from "shiki";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { resolveShikiThemeName } from "@/shared/theme/theme-loader";
import { copyCodeBlockToClipboard } from "@/shared/lib/codeBlockClipboard";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useSmoothCorners } from "@/shared/ui/smoothCorners";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { getReactNodeText } from "./utils";

let shikiHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> | null =
  null;
let shikiInitPromise: Promise<void> | null = null;
const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();
const tokenCache = new Map<string, ThemedToken[][]>();
const MAX_CACHE_ENTRIES = 100;
const MAX_LOADED_LANGUAGES = 30;
const MAX_HIGHLIGHT_LINES = 150;
export const CODE_BLOCK_CLASS =
  "code-block-lines block min-w-full whitespace-pre font-mono text-sm font-medium text-foreground";
const DIFF_ADD_RE = /\s*\/\/\s*\[!code\s*\+\+\]\s*$/;
const DIFF_REMOVE_RE = /\s*\/\/\s*\[!code\s*--\]\s*$/;

function ensureHighlighter(): Promise<void> {
  if (shikiHighlighter) return Promise.resolve();
  if (!shikiInitPromise) {
    shikiInitPromise = getSingletonHighlighter({
      themes: [],
      langs: [],
    }).then((h) => {
      shikiHighlighter = h;
    });
  }
  return shikiInitPromise;
}

/** Load one language and one theme into the singleton, through the same caches
 * and the same language budget the markdown path uses. `false` when the pair
 * cannot serve — an unknown grammar, a theme that failed, or a highlighter this
 * build cannot construct — which the caller must read as "render plain", the
 * same fallback the component below takes. */
async function ensureAssets(language: string, theme: string): Promise<boolean> {
  try {
    await ensureHighlighter();
  } catch {
    return false;
  }
  if (!shikiHighlighter) return false;
  if (!loadedLangs.has(language)) {
    if (loadedLangs.size >= MAX_LOADED_LANGUAGES) return false;
    try {
      await shikiHighlighter.loadLanguage(language as BundledLanguage);
      loadedLangs.add(language);
    } catch {
      return false;
    }
  }
  if (!loadedThemes.has(theme)) {
    try {
      await shikiHighlighter.loadTheme(theme as BundledTheme);
      loadedThemes.add(theme);
    } catch {
      return false;
    }
  }
  return true;
}

/** How many lines one background tokenise slice takes. Measured before it was
 * picked (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 0), on
 * a dense 5,000-line TypeScript fixture with this repo's own shiki 4.1.0:
 * whole-file `codeToTokens` is ~880 ms in ONE main-thread block — the hitch the
 * viewer must never cause; per-slice at 100 lines it is ≤17 ms to tokenise plus
 * ≤17 ms to carry the grammar state, ~1.6 s total spread across the event loop.
 * 200-line slices were ~33 ms each, over a frame; 50-line slices bought nothing
 * further. */
const TOKENIZE_CHUNK_LINES = 100;

/** Tokenise a whole file for the Files viewer, off the render path
 * (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 0: async
 * background highlighting — the viewer renders plain text instantly and swaps
 * these tokens in when they arrive).
 *
 * **The one Shiki, sliced — not a second highlighter.** Same singleton, same
 * grammar cache, same language budget as the markdown path above; what differs
 * is *when* it is asked. The work is cut into `TOKENIZE_CHUNK_LINES`-line
 * slices with the TextMate grammar state carried across the cut
 * (`getLastGrammarState`), so a template literal or block comment spanning a
 * slice boundary tokenises as if the file were done whole. Between slices it
 * yields with `setTimeout(0)` rather than `requestIdleCallback`: the pane sits
 * beside a live terminal, whose stream of frames can starve idle callbacks for
 * seconds, and the slices are already small enough not to need idling
 * (measurement above).
 *
 * Not cached in `tokenCache`: these are whole files, and a hundred-entry cache
 * keyed by full text exists for chat messages — one 512 KiB file would evict
 * half of it for a reread the backend already bounds.
 *
 * `null` when the grammar or theme cannot serve — the caller keeps its plain
 * rendering, which is the same fallback the sync path takes. `cancelled` is
 * read between slices so a file closed mid-tokenise stops costing anything. */
export async function tokenizeChunked(
  code: string,
  language: string,
  theme: string,
  cancelled: () => boolean,
): Promise<ThemedToken[][] | null> {
  const ready = await ensureAssets(language, theme);
  if (!ready || !shikiHighlighter || cancelled()) return null;
  const highlighter = shikiHighlighter;
  const lines = code.split("\n");
  const out: ThemedToken[][] = [];
  let state: ReturnType<typeof highlighter.getLastGrammarState> | undefined;
  for (let at = 0; at < lines.length; at += TOKENIZE_CHUNK_LINES) {
    if (at > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (cancelled()) return null;
    const part = lines.slice(at, at + TOKENIZE_CHUNK_LINES).join("\n");
    try {
      const result = highlighter.codeToTokens(part, {
        grammarState: state,
        lang: language as BundledLanguage,
        theme: theme as BundledTheme,
      });
      state = highlighter.getLastGrammarState(part, {
        grammarState: state,
        lang: language as BundledLanguage,
        theme: theme as BundledTheme,
      });
      out.push(...result.tokens);
    } catch {
      return null;
    }
  }
  return out;
}

export function extractLanguage(className?: string): string {
  if (typeof className !== "string") return "";
  const match = className.match(/language-(\S+)/);
  return match ? match[1] : "";
}

function stripDiffMarker(tokens: ThemedToken[], marker: RegExp): ThemedToken[] {
  const last = tokens[tokens.length - 1];
  if (!last) return tokens;
  const stripped = last.content.replace(marker, "");
  if (stripped === last.content) return tokens;
  if (stripped === "") return tokens.slice(0, -1);
  return [...tokens.slice(0, -1), { ...last, content: stripped }];
}

function getCodeBlockText(children: React.ReactNode) {
  return getReactNodeText(children).replace(/\n$/, "");
}

export function MarkdownCodeBlock({
  children,
  language,
}: {
  children?: React.ReactNode;
  language?: string;
}) {
  const [isCopying, setIsCopying] = React.useState(false);
  const codeBlockRef = React.useRef<HTMLPreElement | null>(null);
  const code = React.useMemo(() => getCodeBlockText(children), [children]);
  useSmoothCorners(codeBlockRef);

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsCopying(true);

      try {
        await copyCodeBlockToClipboard(code);
        toast.success("Copied code to clipboard");
      } catch (error) {
        console.error("Failed to copy code block", error);
        toast.error("Failed to copy code");
      } finally {
        setIsCopying(false);
      }
    },
    [code],
  );

  return (
    <div className="group relative" data-code-block="">
      <pre
        ref={codeBlockRef}
        className="max-h-[400px] overflow-x-auto overflow-y-auto rounded-2xl border border-border/70 bg-muted/60 px-3 py-1.5 pr-12 shadow-xs"
        style={{ borderRadius: "1rem" }}
      >
        {language && (
          <div className="mb-1 text-xs text-muted-foreground/70">
            {language}
          </div>
        )}
        {children}
      </pre>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Copy code block"
            className="absolute right-2 top-2 h-7 w-7 bg-background/80 text-muted-foreground opacity-0 shadow-xs ring-1 ring-border/60 backdrop-blur-sm transition-opacity hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-60"
            disabled={isCopying}
            onClick={handleCopy}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Copy className="h-4 w-4" />
            <span className="sr-only">Copy code block</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy code</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function SyntaxHighlightedCode({
  className,
  code,
  language,
  ...props
}: {
  code: string;
  language: string;
} & React.ComponentProps<"code">) {
  const { themeName } = useTheme();
  // Buzz aliases ("buzz" / "buzz-dark") are not bundled Shiki themes — resolve
  // to the real bundle (github-light / github-dark) before touching Shiki, or
  // it throws and code blocks fall back to plain text.
  const shikiTheme = resolveShikiThemeName(themeName);
  const [loadedKey, setLoadedKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    async function loadAssets() {
      try {
        await ensureHighlighter();
        if (!shikiHighlighter || cancelled) return;
        let loaded = false;
        if (!loadedLangs.has(language)) {
          if (loadedLangs.size >= MAX_LOADED_LANGUAGES) return;
          try {
            await shikiHighlighter.loadLanguage(language as BundledLanguage);
            loadedLangs.add(language);
            loaded = true;
          } catch {
            return;
          }
        }
        if (!loadedThemes.has(shikiTheme)) {
          try {
            await shikiHighlighter.loadTheme(shikiTheme as BundledTheme);
            loadedThemes.add(shikiTheme);
            loaded = true;
          } catch {
            return;
          }
        }
        if (loaded && !cancelled) setLoadedKey((k) => k + 1);
      } catch {
        /* ignore */
      }
    }
    if (!loadedLangs.has(language) || !loadedThemes.has(shikiTheme)) {
      loadAssets();
    }
    return () => {
      cancelled = true;
    };
  }, [language, shikiTheme]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadedKey intentionally triggers re-memoization after async asset loading
  const tokens = React.useMemo(() => {
    if (
      !shikiHighlighter ||
      !loadedLangs.has(language) ||
      !loadedThemes.has(shikiTheme)
    )
      return null;
    if ((code.match(/\n/g) || []).length > MAX_HIGHLIGHT_LINES) return null;
    const cacheKey = `${language}:${shikiTheme}:${code}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) return cached;
    try {
      const result = shikiHighlighter.codeToTokens(code, {
        lang: language as BundledLanguage,
        theme: shikiTheme as BundledTheme,
      });
      if (tokenCache.size >= MAX_CACHE_ENTRIES) {
        const firstKey = tokenCache.keys().next().value;
        if (firstKey !== undefined) tokenCache.delete(firstKey);
      }
      tokenCache.set(cacheKey, result.tokens);
      return result.tokens;
    } catch {
      return null;
    }
  }, [code, language, shikiTheme, loadedKey]);

  const codeClassName = cn(CODE_BLOCK_CLASS, className);

  if (!tokens) {
    const lines = code.split("\n");
    return (
      <code {...props} className={codeClassName}>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
          <span key={i} data-line="">
            {line}
          </span>
        ))}
      </code>
    );
  }

  return (
    <code {...props} className={codeClassName}>
      {tokens.map((line, lineIdx) => {
        const lineText = line.map((t) => t.content).join("");
        const isAdd = DIFF_ADD_RE.test(lineText);
        const isRemove = DIFF_REMOVE_RE.test(lineText);
        const diffClass = isAdd
          ? "code-line-diff-add"
          : isRemove
            ? "code-line-diff-remove"
            : undefined;

        const renderedTokens =
          isAdd || isRemove
            ? stripDiffMarker(line, isAdd ? DIFF_ADD_RE : DIFF_REMOVE_RE)
            : line;

        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
            key={lineIdx}
            data-line=""
            className={diffClass}
          >
            {renderedTokens.map((token, tokenIdx) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional and never reordered
                key={tokenIdx}
                style={token.color ? { color: token.color } : undefined}
              >
                {token.content}
              </span>
            ))}
          </span>
        );
      })}
    </code>
  );
}
