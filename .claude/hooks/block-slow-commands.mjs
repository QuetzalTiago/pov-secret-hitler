// PreToolUse hook: blocks slow browser runs and npm ci/install for agents.
import { pathToFileURL } from 'node:url';

// Anchored at the start of a command segment, so mentions in commit messages or greps do not match.
export const BLOCKED_PATTERNS = [
  /^(npx|pnpm|yarn|bunx)\s+playwright\b/i,
  /^playwright\s+(test|install|show-report)\b/i,
  /^npm\s+(run\s+)?(e2e|perf)\b/i,
  /^(npx\s+)?(tsx|node)\s+(\S*[\\/])?scripts[\\/](perf|snap[\w-]*|preview)\.ts\b/i,
  /^npm\s+ci\b/i,
  /^npm\s+(install|i)\s*$/i,
  /^(\S*[\\/])?(chrome|chromium|msedge)(\.exe)?\b.*--headless\b/i,
];

const SEGMENT_SPLIT = /\r?\n|;|&&|\|\||\|/;
const LEADING_ENV = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/;

export const REASON =
  "Blocked by .claude/hooks/block-slow-commands.mjs: headless-browser runs (Playwright, perf, snapshot scripts) and npm ci/install cost agents ~12 minutes per session and lag the user's PC, so agents never run them on this repo. node_modules is already linked into Fleet worktrees, no install needed. The checks are `npm run typecheck` and `npm test` (~30s). If you truly need a browser run, ask the human to run it themselves with `! <command>`.";

export function isBlocked(command) {
  return command.split(SEGMENT_SPLIT).some((segment) => {
    const cmd = segment.trim().replace(LEADING_ENV, '').replace(/^&\s+/, '');
    return BLOCKED_PATTERNS.some((re) => re.test(cmd));
  });
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
