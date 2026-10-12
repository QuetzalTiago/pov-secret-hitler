// PreToolUse hook: blocks slow browser runs and npm ci/install for agents.
import { pathToFileURL } from 'node:url';

export const BLOCKED_PATTERNS = [
  /\b(npx|pnpm|yarn|bunx)\s+playwright\b/i,
  /\bplaywright\s+(test|install|show-report)\b/i,
  /\bnpm\s+(run\s+)?(e2e|perf)\b/i,
  /scripts[\\/](perf|snap[\w-]*|preview)\.ts\b/i,
  /\bnpm\s+ci\b/i,
  /\bnpm\s+(install|i)\s*($|[;&|])/i,
  /--headless\b/i,
];

export const REASON =
  "Blocked by .claude/hooks/block-slow-commands.mjs: headless-browser runs (Playwright, perf, snapshot scripts) and npm ci/install cost agents ~12 minutes per session and lag the user's PC, so agents never run them on this repo. node_modules is already linked into Fleet worktrees, no install needed. The checks are `npm run typecheck` and `npm test` (~30s). If you truly need a browser run, ask the human to run it themselves with `! <command>`.";

export function isBlocked(command) {
  return BLOCKED_PATTERNS.some((re) => re.test(command));
}

async function main() {
  let command;
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    command = JSON.parse(raw)?.tool_input?.command;
  } catch {
    return;
  }
  if (typeof command === 'string' && isBlocked(command)) {
    process.stderr.write(`${REASON}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
