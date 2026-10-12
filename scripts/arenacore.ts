// Bot arena: seeded games where each team plays its own strategy.
import { randomChooser, oldSmartChooser, runGame, type Chooser, type GameResult } from './gameloop';

export type StrategyName = 'old' | 'random';

// 'new' will be added here later.
export const STRATEGIES: Record<StrategyName, Chooser> = { old: oldSmartChooser, random: randomChooser };

export function playMatch(n: number, seed: number, lib: StrategyName, fas: StrategyName): GameResult {
  return runGame(
    n,
    seed,
    (seat, s) => (s.players[seat].role === 'liberal' ? STRATEGIES[lib] : STRATEGIES[fas]),
    { trackMemory: lib === 'old' || fas === 'old' },
  );
}

export interface ArenaRow {
  players: number;
  games: number;
  libWins: number;
  libPct: number;
  reasons: Record<string, number>;
}

export function runArena(
  lib: StrategyName,
  fas: StrategyName,
  gamesPerCount: number,
  counts = [5, 6, 7, 8, 9, 10],
): ArenaRow[] {
  return counts.map((n) => {
    const reasons: Record<string, number> = {};
    let libWins = 0;
    for (let i = 0; i < gamesPerCount; i++) {
      const r = playMatch(n, n * 100003 + i, lib, fas);
      if (r.winner === 'liberal') libWins++;
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    }
    return { players: n, games: gamesPerCount, libWins, libPct: (100 * libWins) / Math.max(1, gamesPerCount), reasons };
  });
}

const REASON_ORDER = ['liberalPolicies', 'hitlerExecuted', 'fascistPolicies', 'hitlerElected'];

export function formatTable(title: string, rows: ArenaRow[]): string {
  const lines = [title, 'players  games  lib-win%  reasons'];
  for (const r of rows) {
    const reasons = JSON.stringify(Object.fromEntries(REASON_ORDER.map((k) => [k, r.reasons[k] ?? 0])));
    lines.push(
      `${String(r.players).padStart(7)}  ${String(r.games).padStart(5)}  ${String(Math.round(r.libPct)).padStart(8)}  ${reasons}`,
    );
  }
  return lines.join('\n');
}
