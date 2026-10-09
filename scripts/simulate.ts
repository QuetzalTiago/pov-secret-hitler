// Plays 2,000+ full games with random-legal bots at every player count and asserts invariants.
import { playGame, type GameResult } from './simcore';

const total = Number(process.argv[2] ?? 2000);
const counts = [5, 6, 7, 8, 9, 10];
const perCount = Math.ceil(total / counts.length);
const results: GameResult[] = [];
const t0 = Date.now();
let failures = 0;

for (const n of counts) {
  for (let i = 0; i < perCount; i++) {
    const seed = n * 100003 + i;
    const mode = i % 4 === 3 ? 'heuristic' : i % 4 === 2 ? 'smart' : 'random';
    try {
      results.push(playGame(n, seed, mode));
    } catch (err) {
      failures++;
      console.error(`FAIL ${n}p seed=${seed} mode=${mode}:`, (err as Error).message);
    }
  }
}

console.log(`\nPlayed ${results.length} games in ${Date.now() - t0} ms (${failures} failures)\n`);
console.log('players  games  lib-wins  fas-wins  avg-steps  reasons');
for (const n of counts) {
  const rs = results.filter((r) => r.players === n);
  const reasons: Record<string, number> = {};
  for (const r of rs) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const lib = rs.filter((r) => r.winner === 'liberal').length;
  const avg = rs.reduce((a, r) => a + r.steps, 0) / Math.max(1, rs.length);
  console.log(
    `${String(n).padStart(7)}  ${String(rs.length).padStart(5)}  ${String(lib).padStart(8)}  ${String(rs.length - lib).padStart(8)}  ${avg.toFixed(1).padStart(9)}  ${JSON.stringify(reasons)}`,
  );
}
if (failures > 0 || results.length < total) {
  console.error('\nSIMULATION FAILED');
  process.exit(1);
}
console.log('\nAll invariants held; every game produced a winner.');
