import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isBlocked } from '../.claude/hooks/block-slow-commands.mjs';

const hookPath = fileURLToPath(new URL('../.claude/hooks/block-slow-commands.mjs', import.meta.url));

const runHook = (command: string) =>
  spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });

describe('block-slow-commands hook', () => {
  it.each([
    'npx playwright test',
    'npm run e2e',
    'npm run perf -- --gpu',
    'npx tsx scripts/snap-gun.ts',
    'npx tsx scripts/perf.ts',
    'npm ci',
    'npm install',
    'npm i && npm test',
    'cd C:/x/repo; npm ci',
    'cd repo && npx playwright test',
    'FOO=1 npm run e2e',
    '& npx playwright test',
    'npm test\nnpm ci',
  ])('blocks %s', (command) => {
    expect(isBlocked(command)).toBe(true);
  });

  it.each([
    'npm test',
    'npm run typecheck',
    'npx vitest run tests/engine.test.ts',
    'npm install three@0.186.1',
    'grep -rn playwright README.md',
    'npm run build',
    'git log --oneline',
    'git commit -m "remove e2e; hook blocks npm ci for agents"',
    'git commit -F msg.txt',
    'echo "never run npx playwright test"',
    'grep -n "npm ci" README.md',
    "git commit -q -F - <<'EOF'\nRemove the e2e; agents spent minutes on headless-Chrome scripts and npm ci.\nEOF",
  ])('allows %s', (command) => {
    expect(isBlocked(command)).toBe(false);
  });

  it('exits 2 with a reason for a blocked command', () => {
    const res = runHook('npm run e2e');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Blocked by .claude/hooks/block-slow-commands.mjs');
  });

  it('exits 0 for an allowed command', () => {
    expect(runHook('npm test').status).toBe(0);
  });
});
