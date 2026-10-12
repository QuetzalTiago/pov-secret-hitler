# Game improvements spike (todo #172), 2026-10

## Question

What would make POV Secret Hitler a better game: more fun, with UX that stays pleasant? Why would each change help, and in what order should the changes happen?

## Method and scope

- This is read-only evidence from `client/`, `server/`, `shared/` and the earlier spikes in this folder. There were no browser or perf runs.
- The game design review (#145, `game-design-review-2026-10.md`) is the baseline. This spike checks whether its gaps are still open, then looks at what it did not cover:
  - the outer session loop: getting into a game, playing again, and reasons to come back
  - table options
  - how the big rule moments are presented
  - small bugs
- Bot play style and difficulty belong to the "Smarter bots" spike (#173). This spike only lists the evidence for them.

## What I verified

### Every gap from #145 is still open

None of the FLT-0003 todos (#146–#161) has landed or started: no commit names them and no `design-deduction` branch exists. All work since #145 (#162–#171) went into visuals, ceremonies and models. Each gap below was re-checked today:

- **Bot role tell.** A nominated bot's small talk depends on its role (`server/botchat.ts:204-207`).
- **Fascist bots are predictable.** They always discard L and enact F. The score gap is 2, but the noise is at most 0.6 (`shared/smartbot.ts:176,190,215`).
- **No public record.** `GameView` has no history (`shared/view.ts:15-44`). The server sends `lastVotes`, but the client never reads it.
- **Chat can't scroll back.** The chat log is `overflow:hidden` (`client/style.css:315`).
- **Bots are mute without an LLM** (`server/room.ts:611-613, 848, 912`).
- **Two `feel()` branches never run.** The grudge and liberal-rapport branches read `nominee` and `chancellor` after the engine has cleared them (`room.ts:1048,1064`).
- **No AFK escalation** (`room.ts:444-456`).
- **No Hitler-zone warning in the HUD** (`client/hudmodel.ts`). The rule appears only as text on the board.
- **Feedback gaps:**
  - Special election plays no sound.
  - `sfx.chat` is never called.
  - There are no claims.
  - The game-over screen has no recap.

### New findings

- **Pacing and passive time.**
  - A 7-player game with one human takes about 10–12 minutes.
  - A successful round takes about 44 s. Nominate takes about 13 s, vote 12 s, the President's discard 11 s and the Chancellor's enact 8 s. These come from `server/pacing.ts` think and settle times at the default `botDelayMs` of 1400.
  - A human gives at most one input per round. The rest of the time they can look around, chat, or glance at a seat through the roster.
  - There is no way to note suspicions, and investigation results can't be viewed again once the card is put away.
- **Getting in is slow.**
  - A solo player needs about 6 clicks: type a name, Open table, +Bot ×4, Deal.
  - There is no "play vs bots" button.
  - Rules are reachable only from the in-game ⚙ menu.
- **After the game there is nothing for guests.**
  - Only the host sees "Back to the lobby" (`client/ui.ts:659`). Guests can only leave.
  - There is no series score.
  - Nothing is remembered between games: `server/store.ts` keeps only room snapshots, deleted after 6 hours.
- **No table options.**
  - Bot speed, timers and bot language are server environment variables only (`server/config.ts:19-20,55`).
  - The host can only add or remove bots, one at a time.
  - Bot language defaults to es-AR. This is assumed to be intentional.
- **Bots sound different but play the same.**
  - The 8 personas change only chat. `decide()` ignores persona (`server/brain.ts:16-45`), and only tempo differs (`pacing.ts:32-36`).
  - The persona is never shown.
  - This is left to #173.
- **The big rule moments are presented worst.**
  - **Chaos.** The engine emits `tracker 3` and then `tracker 0` in one batch (`shared/engine.ts:254-265`). The client places the coin from the final view (`client/game.ts:748`), so the coin slides from 2 back to 0 and never shows 3.
    - The Extrablatt banner can't be skipped (`client/enact.ts:28-29`), and it covers the vote reveal.
    - Four toasts fire at once, which is exactly the cap (`ui.ts:519`).
  - **Hitler elected.** The victory overlay arrives 1 s into the 4.5 s vote reveal, and nothing names Hitler first.
  - **Veto.** Unlocking it at 5 Fascist policies is silent, and nothing explains that an accepted veto advances the tracker.
  - **Sounds.**
    - The tracker advance plays the countdown `tick`.
    - Nomination reuses the generic `slide`.
    - Chaos has no sound.
- **Rough edges.**
  - Clicking doesn't skip the victory overlay under pointer lock (`ui.ts:136-142`).
  - The investigation card stays in your hand and keeps `cardMode()` true (`game.ts:336,758`).
  - In power phases, watchers see an empty detail line (`hudmodel.ts:181-217`).
  - There is no touch play at all.
  - The lobby has no chat input.

## Scores

The 8 dimensions are re-scored from #145, plus one new dimension.

| Dimension | #145 | Now | Why |
|---|---|---|---|
| Clarity | 5 | 6 | The #142 HUD landed, but the Hitler-zone danger is still invisible |
| Decision quality | 3 | 3 | Still no public record (FLT-0003) |
| Feedback & feel | 7 | 7 | Ceremonies were added, but the chaos, Hitler and veto beats are weak |
| Pacing | 6 | 6 | Bots pace like people, but there is a lot of passive time and no speed option |
| Social deduction depth | 3 | 3 | Still no claims (FLT-0003) |
| Bot believability | 4 | 4 | The tells remain; personas don't change play |
| Onboarding | 4 | 4 | Rules are only in the ⚙ menu (FLT-0003 #161) |
| Atmosphere & POV | 8 | 9 | Beer hall, period HUD and models |
| **Session loop (new)** | — | 3 | Slow to start, no play-again for guests, no reason to come back |

**Overall: 45/90.** The gap from #145 has widened. The game looks much better than it plays.

## Why these changes make it more fun

- **Deduction is the fun of Secret Hitler.** Players need evidence (votes, governments, claims), and they need evidence that can be checked. Without a record, votes are blind and lies cost nothing. That is FLT-0003 and the biggest lever.
- **Less friction means more games.**
  - A one-click start and a real "Play again" turn one game into a session.
  - A series score and a personal record give a reason to play one more.
- **Big rule moments are the stories players tell.** Chaos, Hitler elected and the veto should each land as a beat of their own, not collide with the vote reveal.
- **Something to do while waiting.** Private suspicion marks turn about 30 s of watching each round into active reading of the table. They also prepare players for the FLT-0003 ledger.

## Options

- **Recommended order:**
  1. FLT-0003 first: #146–#148 and #152–#155, the information loop.
  2. In parallel, FLT-0004's independent items (#178 bug pack and #179 quick start), which touch different files.
  3. Then the rest of both tasks.

  FLT-0002 #133 (your-turn chime and tab title) and #135 (idle pulse and edge arrow) landed while this spike ran, and they help with the passive time. Of FLT-0002, #136 (opt-in notifications) and #137 (pacing playtest) are still open.
- **Rejected: more visual polish now.** Atmosphere is already the highest-scoring dimension, so more of it adds the least.
- **Rejected: accounts and server-side stats.** A localStorage record gives most of the "reason to come back" at almost no cost.
- **Rejected for now: full touch controls.** It is a large change, and the pointer-lock interaction model would need a redesign. It is in the Fleet backlog.

## Ranked new fixes

| # | Fix | Tier | Files | Needs |
|---|---|---|---|---|
| 1 | Bug pack: chaos coin shows 3, victory skip under pointer lock, investigation card cleared, chat scroll-back | Must | `client/game.ts`, `ui.ts`, `style.css` | — |
| 2 | "Play vs bots": one click to a 7-seat dealt table | Must | `client/index.html`, `ui.ts`, `server/room.ts` | — |
| 3 | Host table options: pace Relaxed / Normal / Fast | Should | `server/room.ts`, `pacing.ts`, `shared/protocol.ts`, `client/ui.ts` | 2 |
| 4 | Play again for everyone (ready-up) plus a series score | Must | `server/room.ts`, `client/ui.ts` | — |
| 5 | Personal record in localStorage | Should | `client/record.ts` (new), `ui.ts` | 4 |
| 6 | Big moments: chaos beat, Hitler-elected reveal, veto unlock, distinct sounds, skippable Extrablatt | Should | `client/game.ts`, `enact.ts`, `victory.ts`, `audio.ts` | 1 |
| 7 | Private suspicion marks, roster intel tags, watcher copy in power phases | Should | `client/hudmodel.ts`, `ui.ts` | 1 |

## Risks and open questions

- **New room snapshot fields (fixes 3 and 4)** need defaults so that old snapshots still load.
- **File overlap with FLT-0003.**
  - Fix 6 overlaps FLT-0003 #151 (juice gaps) and fix 7 overlaps #152 (ledger), in `client/game.ts`, `ui.ts` and `hudmodel.ts`.
  - Whichever lands second rebases.
  - #151 owns the special-election and chat sounds. Fix 6 must not duplicate them.
- **The pace option** must stay proportional to `config.botDelayMs`. Tests use 5 ms for fast games and 1e6 to freeze bots.
- **Bot play style and difficulty** are left to the Smarter bots spike (#173). Fix 3 leaves room for a difficulty option there.
- **Open question for the human:** is the es-AR default for bot language intended for English-speaking players?

## Follow-up tracking

Task **FLT-0004** "Game loop: quick start, play again, table options and big moments" (branch `game-loop`). Each todo is one commit.

| Todo | Fix | Needs |
|---|---|---|
| #178 | 1. Bug pack | — |
| #179 | 2. Play vs bots | — |
| #180 | 4. Play again plus series score | — |
| #181 | 6. Big moments | start after #178, which also changes the tracker coin; Fleet couldn't link this |
| #182 | 7. Suspicion marks and intel | start after #178, which shares `ui.ts`; Fleet couldn't link this |
| #183 | 3. Table options (pace) | #179 |
| #184 | 5. Personal record | #180 |

- **Fleet backlog:** touch play (tap to act, drag to look), and quick-chat reactions with a lobby chat input.
- **Still the top priority:** FLT-0003 (#146–#161).
