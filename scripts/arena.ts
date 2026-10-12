// Bot arena CLI: tsx scripts/arena.ts [gamesPerCount] [--lib old|new|random|casual|normal|sharp] [--fas <same names>]
import { formatTable, runArena, STRATEGIES, type StrategyName } from './arenacore';

const args = process.argv.slice(2);
let games = 400;
let lib: string | undefined;
let fas: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--lib') lib = args[++i];
  else if (args[i] === '--fas') fas = args[++i];
  else games = Number(args[i]);
}
if (!Number.isInteger(games) || games < 1) {
  console.error('gamesPerCount must be a positive integer');
  process.exit(1);
}
for (const name of [lib, fas]) {
  if (name !== undefined && !(name in STRATEGIES)) {
    console.error(`Unknown strategy "${name}"; expected one of: ${Object.keys(STRATEGIES).join(', ')}`);
    process.exit(1);
  }
}

const matchups: [StrategyName, StrategyName][] =
  lib === undefined && fas === undefined
    ? [['old', 'old'], ['old', 'random'], ['random', 'old'], ['random', 'random']]
    : [[(lib ?? 'old') as StrategyName, (fas ?? 'old') as StrategyName]];

const t0 = Date.now();
for (const [l, f] of matchups) {
  console.log(formatTable(`Liberals: ${l}  vs  Fascists: ${f}  (${games} games per count)`, runArena(l, f, games)));
  console.log('');
}
console.log(`Total ${Date.now() - t0} ms`);
