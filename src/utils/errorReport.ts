/**
 * fix/v1.1.4 — the text behind "Details" on the "Something went wrong"
 * screen: enough to tell which build failed, where and how, short enough
 * to paste into a message. Pure, so the screen and the tests share it.
 */

/** Query keys the app reads itself; their values say nothing private. */
const SAFE_QUERY_KEYS = new Set(['game', 'auto', 'max', 'stats', 'showcase']);
const STACK_LINES = 8;

/**
 * The page address without anything that could be a secret: values of
 * unknown query keys are dropped (the key stays, so the shape is still
 * visible) and the fragment, where OAuth-style tokens travel, is never
 * included.
 */
export function safeUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return '(unparsable URL)';
  }
  const parts: string[] = [];
  for (const [key, value] of url.searchParams) {
    parts.push(SAFE_QUERY_KEYS.has(key) ? `${key}=${encodeURIComponent(value)}` : `${key}=…`);
  }
  const query = parts.length > 0 ? `?${parts.join('&')}` : '';
  const hash = url.hash ? '#…' : '';
  return `${url.origin}${url.pathname}${query}${hash}`;
}

function firstLines(text: string | null | undefined, n: number): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(0, n);
}

export interface ErrorReportInput {
  error: unknown;
  componentStack?: string | null;
  version: string;
  href: string;
  userAgent: string;
  at: Date;
}

export function errorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return `Non-Error thrown: ${String(error)}`;
  } catch {
    return 'Non-Error thrown';
  }
}

export function buildErrorReport(input: ErrorReportInput): string {
  const { error, componentStack, version, href, userAgent, at } = input;
  const lines = [
    `Subutai v${version}`,
    `Time: ${at.toISOString()}`,
    `URL: ${safeUrl(href)}`,
    `Browser: ${userAgent}`,
    `Error: ${errorSummary(error)}`,
  ];
  // The first stack line repeats "Name: message" in V8; skip it then.
  const stack = firstLines(error instanceof Error ? error.stack : null, STACK_LINES + 1);
  if (stack.length > 0 && error instanceof Error && stack[0].includes(error.message)) stack.shift();
  if (stack.length > 0) lines.push('Stack:', ...stack.slice(0, STACK_LINES).map((l) => `  ${l.trim()}`));
  const comp = firstLines(componentStack, STACK_LINES);
  if (comp.length > 0) lines.push('Components:', ...comp.map((l) => `  ${l.trim()}`));
  return lines.join('\n');
}
