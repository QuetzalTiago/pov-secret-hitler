# Smarter bots spike (todo #173), 2026-10

## Question

What makes the bots weak or predictable, and what would make them play like a veteran Secret Hitler player? The answer had to be measured, not guessed. It decides what to build, in what order, and how to prove that each step made the bots better.

## What I verified

### Where bot moves come from

- `server/brain.ts` `decide()` asks Jev first (`server/jev.ts`). If Jev is off or fails, it falls back to `shared/smartbot.ts` `buildDecision` + `heuristicChoice`, which picks the best score plus `rand() * 0.6` noise.
- `decideNow()` uses only the built-in strategy. It runs on timeouts and in the simulator (`scripts/simcore.ts`, `smart` mode).
- Memory lives in `shared/tracker.ts`. `profiles()` gives each seat an *additive* suspicion score:
  - +0.8 for a President and +1.0 for a Chancellor of each Fascist government;
  - −0.6 / −0.7 for each Liberal government;
  - +0.25 for a JA on a government that enacted Fascist;
  - hard proofs from the bot's own hands (+5 for "I passed them a Liberal and they enacted Fascist") and its own investigations (±10).
- `shared/bot.ts` is an older light heuristic. Only the simulator uses it.
- Personas (`server/persona.ts`) change only chat and tempo. `decide()` ignores them (reported by the #172 spike).

### Measurement

A scratch harness (not committed) played 400 seeded games per player count. It used the same code path as simcore's `smart` mode, with each team's strategy chosen separately: either `smart` (buildDecision + heuristicChoice) or `random` (a random legal action).

Liberal win rate (%):

| Liberals vs Fascists | 5p | 6p | 7p | 8p | 9p | 10p |
|---|---|---|---|---|---|---|
| smart vs smart | 82 | 77 | 56 | 72 | 53 | 65 |
| smart vs **random** Fascists | 68 | 77 | 67 | 74 | 70 | 70 |
| random Liberals vs smart | 15 | 15 | 10 | 12 | 9 | 7 |
| random vs random | 25 | 24 | 24 | 22 | 22 | 27 |

Over the 2,400 smart-vs-smart games, the win reasons were: Liberal policies 970, Hitler executed 647, Hitler elected 609, Fascist policies 174.

#### Arena baseline (FLT-0005 #185)

`npm run arena 400` (seeds `n * 100003 + i`) now reproduces this. 'old' is today's buildDecision + heuristicChoice with tracker memory. The numbers match the scratch harness within noise. Later strategy changes are measured against this table.

| Liberals vs Fascists | 5p | 6p | 7p | 8p | 9p | 10p |
|---|---|---|---|---|---|---|
| old vs old | 78 | 83 | 57 | 70 | 49 | 68 |
| old vs random | 69 | 75 | 66 | 72 | 64 | 72 |
| random vs old | 13 | 14 | 11 | 11 | 7 | 6 |
| random vs random | 23 | 22 | 25 | 23 | 25 | 22 |

Old-vs-old win reasons over 2,400 games: Liberal policies 946, Hitler executed 670, Hitler elected 651, Fascist policies 133.

### Findings

1. **The smart Fascists play no better than random ones.**
   - At 5p, smart Fascists lose *more* often than random Fascists (82% vs 68% Liberal wins).
   - The cause: Fascists, Hitler included, always discard L and enact F (`shared/smartbot.ts:176,190`). The score gap of 2 vs 0 can never be flipped by `rand() * 0.6`.
   - As a result, Hitler is executed in 27% of games.
2. **The Liberals can't really deduce.** Suspicion is a sum of fixed weights:
   - It ignores deck odds. A President drawing three Fascists is common with 11 F / 6 L.
   - It never derives "confirmed not Hitler", and never uses claims, human chat or nomination patterns.
   - It reads votes only through the "JA on a Fascist government" counter.
3. **Score tweaks move the numbers, but with no model behind them.** Two experiments in the scratch harness:
   - *Fascist cover play* (Hitler plays Liberal cards 85% of the time before the Hitler zone; Fascists 45%): Hitler executions fell from 647 to 174, but the Fascists hand over Liberal policies, so the win rate barely moved (5p 82→66%, 9p 53→60%). Cover has to depend on how suspicious the bot already looks.
   - *Liberals use "confirmed not Hitler"* (a Chancellor elected in the Hitler zone without the game ending can't be Hitler): Liberal wins rose 5 to 11 points at every player count (5p 82→88, 9p 53→64, 10p 65→76).
4. **Exact inference is cheap.** The largest table, 10 players, has C(10,1) × C(9,3) = 840 possible role assignments, so a bot can weigh every one on every decision.
5. **Overlap with FLT-0003.** None of it has landed yet. FLT-0003 owns structured claims: #154 the claims record, #156 bots post claims, #157 bots read claims, and #160 Fascist cover play.

## Options

- **Recommended: an exact belief model plus strategies built on it.**
  - Each bot enumerates the role assignments consistent with its own view (own role, known teammates, investigations).
  - It weights each assignment by how likely the public record is under a simple behaviour model:
    - deck-aware odds of each government's F/L result;
    - the bot's own passed and received hands;
    - votes, nominations and executions as weak signals;
    - hard facts such as "elected in the Hitler zone and the game went on, so not Hitler".
  - The output is P(Fascist team) and P(Hitler) per seat.
  - Both teams' strategies are rewritten on these beliefs. Fascists also run the model from a Liberal observer's perspective, to judge how suspicious they look before choosing cover.
- **The built-in strategy becomes primary (user decision).** Jev only breaks near-ties between the top options, and it reads the belief summary in its state.
- **A difficulty setting per room (user decision):** Casual, Normal or Sharp, chosen by the host in the lobby.
- Rejected:
  - *More score tweaks:* no model, and every tweak trades one weakness for another (finding 3).
  - *ISMCTS / game-tree search:* CPU cost on the shared host, and hard to keep humane.
  - *LLM-only decisions:* can't be measured offline, cost money per move, and are unreliable at counting.

## Risks and open questions

- **Bots that are too strong are not fun.** The target is a fair table, with smart-vs-smart Liberal wins between 45% and 60% at every player count. The Casual level keeps today's feel.
- **Behaviour-model weights are guesses until the arena tunes them.** Every strategy change is accepted on arena numbers plus `npm run simulate`, never on reasoning alone.
- **Jev as a tie-break** means less Jev traffic. Its value shrinks to flavour among close options.
- **Claims (FLT-0003 #157)** should plug into the belief model as extra likelihood factors, not as a second suspicion system.
- **Bot pacing** could later use belief closeness to hesitate longer on hard calls. That is not filed.

## Follow-up tracking

The follow-up is Fleet task **FLT-0005**, "Smarter bots" (branch `smarter-bots`). Each todo is one commit. "Needs" lists what must land first. The Fleet todo ids are A = #185, B = #186, C = #187, D = #188, E = #189, F = #190 and G = #191.

| Todo | Work | Needs |
|---|---|---|
| A | **Bot arena.** `scripts/arena.ts` + `npm run arena`: seeded games with a strategy per team (old smart / new / random), printing Liberal win % and win reasons per player count. Shares its game loop with `scripts/simcore.ts`. `tests/arena.test.ts` checks that smart Liberals beat random ones. | — |
| B | **Belief model** `shared/belief.ts`: enumeration, hard constraints and soft likelihoods; `beliefs(memory, view)` returns pFascist[] and pHitler[], with an observer-perspective option. Pure, unit-tested, under 2 ms at 10p. | — |
| C | **Liberal strategy on beliefs** in `shared/smartbot.ts`, with Hitler-zone strictness. Arena: beats the old Liberals at every count. | A, B |
| D | **Fascist and Hitler strategy on beliefs:** a clean Hitler, cover play judged against how suspicious the bot looks, coordinated votes, Hitler-zone pushes and execution targets. Supersedes FLT-0003 #160. Arena: new vs new is 45–60% Liberal wins. | A, B |
| E | **Built-in strategy primary, Jev as tie-break** in `server/brain.ts`; the belief summary goes into Jev's state. | C, D |
| F | **Talk matches play:** chat accusations and reads use beliefs (`server/botchat.ts`, `server/bottalk.ts`, the room's mood tick). | C |
| G | **Difficulty per room** (Casual / Normal / Sharp): protocol, room config, store and the lobby selector. Shares the lobby slot with FLT-0004's host pace option. | C, D, E |

## #206 NEIN votes

The belief model now reads NEIN votes (`NEIN_CLEAN_LIBERAL`, `NEIN_TEAM_FASCIST`), and the Fascist vote rules follow:

- **Fascists block only while they look safe.** A Fascist votes NEIN on a government with no teammate while `tracker < 2` *and* the table's P(Fascist) of them is below `FAS.neinP + loneAdd`. Otherwise JA, as before. Teammate and zone-Hitler votes are unchanged.
- **Hitler before the zone votes like a Liberal.** Same formula as the Liberals (`libVoteScore`, shared by both), fed with the table's beliefs of Hitler. In the zone he votes as a Fascist again.

Re-tuning (new vs new, 400 games per count, Liberal win % at 5/6/7/8/9/10 players):

| Step | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|
| Before the NEIN factor | 54 | 57 | 58 | 53 | 57 | 51 |
| After the NEIN factor, not re-tuned | 60 | 62 | 48 | 41 | 50 | 37 |
| New vote rules, not re-tuned | 64 | 65 | 69 | 68 | 66 | 65 |
| **Final, 400 games** | 54 | 58 | 56 | 58 | 54 | 52 |
| **Final, 1000 games** | 54 | 58 | 57 | 58 | 50 | 49 |
| Final, new Liberals vs old Fascists (400) | 91 | 90 | 69 | 78 | 62 | 74 |
| old vs old (400, unchanged) | 78 | 83 | 57 | 70 | 49 | 67 |

Weights changed:

| Weight | Was | Now |
|---|---|---|
| `FAS.neinP` | (new) | 0.8 |
| `FAS.coverP` | 0.5 | 0.55 |
| `FAS.proofP` | 0.24 | 0.15 |
| `LIB.voteBase` | 1 | 2 |
| `FASCIST_PLAYS_F` | 0.85 | 0.5 |
| `JA_ON_F_LIBERAL` | 0.8 | 0.95 |
| `NEIN_CLEAN_LIBERAL` | 0.5 | 0.35 |
| `NEIN_TEAM_FASCIST` | 0.3 | 0.5 |

What the tuning showed:

- Both new rules hurt the Fascists a lot. Blocking every Liberal government is a strong play, and Hitler voting like a Liberal passes more Liberal governments. Together they moved the Liberals to 64-69%.
- `FAS.coverP` has a cliff at 0.5: with 7 or 9 players the table's prior P(Fascist) is exactly 0.5, so a lower value covers from the first round. Keep it above the prior.
- `LIB.voteBase` above 2 balances new vs new, but then the old Fascists beat the new Liberals at 9 players (the Liberals say JA to too many Fascist governments). At 2 the new Fascists still beat the old ones at every count.
- At 6 players the Liberal win rate barely reacts to any Fascist weight; `FASCIST_PLAYS_F`, `NEIN_*` and `voteBase` were the levers that moved it.
