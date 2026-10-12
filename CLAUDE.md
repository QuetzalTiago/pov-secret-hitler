# Agent rules

- Checks are `npm run typecheck` and `npm test` (~30s total). Run `npm run simulate` only when shared/engine rules change.
- Never run Playwright, `npm run perf`, `scripts/perf.ts`, headless Chrome, `npm ci` or a bare `npm install`.
  node_modules is linked into Fleet worktrees, so no install is needed.
- Judge UI changes by reading code and unit tests. The human checks visuals in the live game.
- `.claude/hooks/block-slow-commands.mjs` enforces the two rules above. If you truly need a browser run, ask the human to run it.
- Never start a second game host (`npm run host`). The site is supervised by a scheduled task.
