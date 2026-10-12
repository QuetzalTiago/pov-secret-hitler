# Fun and polish spike (todo #262), 2026-10-12

## Question

What would make POV Secret Hitler more fun and more polished now? A good answer says what to build next and in what order, so sessions stop spending on the dimension that already scores highest (atmosphere).

## Method and scope

- This is read-only evidence from `client/`, `server/` and `shared/`, plus a git log check of every follow-up todo from the earlier spikes. There were no browser or perf runs.
- The baselines are #145 (`game-design-review-2026-10.md`) and #172 (`game-improvements-2026-10.md`). This spike re-checks what is still open from them and adds the gaps they did not cover.
- These were in flight in sibling sessions while this spike ran, so this spike does not plan them:
  - #259 (bots nagging a silent player) landed as bb922b8.
  - #261 (ES/EN language support).
  - #263 (Fascist bots lie about the hand they drew).

## What I verified

### Follow-up tasks: one big one never started

| Task | Topic | Status (git log `todo #N`) |
|---|---|---|
| FLT-0003 #146–#161 | Public record, ledger, claims, honest bots | **No commits. Not started.** |
| FLT-0004 #178–#184 | Quick start, play again, pace, big moments, record | All landed |
| FLT-0005 #185–#191 | Belief-model bots, levels | All landed |
| FLT-0006 #195–#202 | Official art | All landed |
| FLT-0008 #235–#241 | Blood and gore | Landed, **except the #240 Blood pref** (see below) |

Every polish pass since #145 has gone to visuals, models, blood and sound. The information loop, which both earlier spikes ranked as the biggest fun lever, is untouched.

### Still open from FLT-0003 (re-checked today)

- **Bot role tell.** At nomination, a Fascist bot says "Trust me." / "You won't regret it." and a Liberal bot says "I won't let you down." (`server/botchat.ts:232-234`). This is #146.
- **`feel()` reads state the engine already cleared.** This is #147.
  - Enacted branch (`server/tabletalk.ts`, the `e.k === 'enacted'` arm): it reads `g.chancellor`, but `startPresidency` has already nulled it (`shared/engine.ts:216-227,262-268`). Liberal governments therefore never earn rapport unless a power fired.
  - Votes branch: on a failed vote it reads `g.nominee`, which is already null (`engine.ts:317-319`), so the "rejected nominee holds a grudge" line never fires.
- **No public record.** `lastVotes` is in `GameView` (`shared/view.ts:36,92`), but nothing in `client/` reads it. The roster badges show no per-player vote. The only vote record is a toast that fades (`client/eventcopy.ts:34-39`). This is #148 and #152.
- **No claims.** No `claim` exists in `shared/protocol.ts`, `shared/types.ts` or `server/room.ts`. This is #154 and #155.
- **No Hitler-zone warning.** The vote copy is just "President X · Chancellor Y" (`client/hudmodel.ts:179-183`). This is #153.
- **No game-over recap.** The game-over screen shows roles, the reason and the series score only (`client/ui.ts:887-915`). This is #159.
- **Bots are mute to humans without an LLM.** `botsReactTo` returns before replying when `!canWrite()`, and so does `moodTick` (`server/tabletalk.ts`). This is #149.
- **No AFK escalation.** A timeout bot-plays the move once, with no strike count (`server/room.ts:548-560`). This is #150.
- **Juice gaps.**
  - `sfx.chat` is defined (`client/audio.ts:296`) but never called.
  - Special election and investigate play no sound (`client/game.ts:938-943`).
  - This is #151.
- **Rules are only in the in-game ⚙ menu.** The home and lobby panels have no Rules button (`client/index.html:33-81`). This is #161.

### New findings

1. **The Blood On/Off pref never shipped.**
   - The FLT-0008 decision says "Gore defaults On, with a Blood On/Off pref and `?gore=0`", and the #241 commit message says "The Blood pref (todo #240) gates Bloodshed".
   - No `gore` string exists anywhere in `client/` or `tests/`, and no commit names #240.
   - Players who don't want gore have no way to turn it off.
2. **Audio settings are thin.**
   - Sound is an on/off toggle that is not persisted (`let muted = false`, `client/audio.ts:5`), so it resets to on at every reload. Music is persisted (`audio.ts:428,459`).
   - Master volume is fixed at 0.8 (`audio.ts:15`), and there is no volume slider.
3. **Night never tells you how you win.**
   - The night copy is "Check your secret role / Click your envelope" and then "Memorise your role" (`client/hudmodel.ts:154-166`). The role chip is just the role name (`hudmodel.ts:80`).
   - A first-time Hitler is never told "stay hidden and get elected Chancellor after 3 Fascist policies". A first-time Fascist is never told that they know Hitler but Hitler may not know them.
4. **The lobby can't type.**
   - `#lobby-chat` only shows the last 6 lines (`client/ui.ts:872-877`).
   - The chat input lives in `#hud`, which is hidden in the lobby, and Enter only works when the HUD is visible (`ui.ts:252`).
   - Friends waiting for the host to deal can't talk.
5. **Bots without an LLM repeat themselves.**
   - Most template situations in `server/botchat.ts:96-256` have 1–2 lines: president truth 1, chancellor truth 1, investigation 1 each, veto 1, chaos 2, executed 2.
   - In a 10–12 minute game the same lines come back many times.
   - This also overlaps the #146 role tell. When the pools grow, the Fascist and Liberal pools must be the same.
6. **A move made during a disconnect is lost without a word.**
   - `net.ts` reconnects with backoff (0.5 → 8 s) and shows "Connection lost. Reconnecting…" (`client/main.ts:105`).
   - A click made while offline is dropped on purpose (`client/net.ts:43`), with no feedback.
   - There is no "Reconnected" confirmation.
7. **Bot language vs UI language.**
   - Bots default to `es-AR` (`server/config.ts`), while the client UI is all English (`client/index.html:2`).
   - #261 (in flight) should make the table's language one setting. If it doesn't, follow-up 7 below does.

## Scores

#172 scores, updated. Only rows that changed have a new reason.

| Dimension | #172 | Now | Why |
|---|---|---|---|
| Clarity | 6 | 6 | No role goal at night, no Hitler-zone alarm |
| Decision quality | 3 | 3 | Still no public record (FLT-0003 not started) |
| Feedback & feel | 7 | 8 | Big-moment beats (#181), blood, screams, stings |
| Pacing | 6 | 7 | Pace option (#183), quick start |
| Social deduction depth | 3 | 3 | Still no claims |
| Bot believability | 4 | 5 | The belief model plays well, but the role tell and repetitive templates remain, and bots are mute offline |
| Onboarding | 4 | 4 | Rules still only in-game; no role goals |
| Atmosphere & POV | 9 | 9 | Already the best dimension |
| Session loop | 3 | 6 | Play vs bots, play again, series score, personal record |

**Overall: 51/90, up from 45.** The gains all came from FLT-0004 and polish. The two weakest dimensions, decision quality and deduction depth (3 each), are exactly what FLT-0003 fixes.

## Options

- **Recommended: start FLT-0003 now, in its own sessions, in this order:**
  1. #146 role tell and #147 `feel()` bugs. Both are small and independent.
  2. #148 public record.
  3. #152 ledger and #153 Hitler-zone alarm.
  4. #154 claims record, then #155 quick-claim UI.
  5. #156 bots post claims, #157 bots read claims, #159 recap, #161 first-game coach.

  FLT-0003 amendments (already decided in #173):
  - #160 (Fascist cover play) is superseded by FLT-0005. Skip it.
  - Build #157 as likelihood factors in `shared/belief.ts`, not in `tracker.ts`.
  - #142 has landed, so the cross-task "after #142" notes in #152, #153 and #161 are satisfied.
- **In parallel: the new "fun-polish" task below.** Its files barely touch FLT-0003's:
  - prefs: `audio.ts`, the settings menu
  - blood gating: `game.ts`, `screenblood.ts`
  - lobby chat
  - night copy in `hudmodel.ts`
  - reconnect: `net.ts`

  The template pools in `botchat.ts` wait for #146.
- **Rejected: more lighting, model or prop polish.** Atmosphere is at 9, so more of it adds the least fun per session.
- **Rejected for now: touch play.** It is still in the backlog, because pointer-lock look would need a redesign.
- **Rejected: volume per sound category beyond music and SFX.** Two sliders cover the real complaint.

## Risks and open questions

- **`hudmodel.ts` overlap.** #153 (FLT-0003) and the role-goal todo both edit it. Whichever lands second rebases. The changes are small and in different functions (night copy vs vote copy).
- **#261 (i18n) will move UI strings.** All new copy in this task must go through whatever string table #261 introduces. Briefs should check for it first.
- **#263 and template variety both edit `botchat.ts`.** The pools todo waits for #146, and it should also wait for #263 to land.
- **Blood pref default.** The FLT-0008 decision says the default is On. The pref only adds the off switch.
- **Open question for the human:** should the Blood pref also be offered at the first deal, like a content warning, or only in ⚙? This spike assumes only in ⚙ plus `?gore=0`.

## Follow-up tracking

Task **FLT-0009** "Fun and polish: settings, first game, lobby, bot talk" (branch `fun-polish`). Each todo is one commit. FLT-0003 (#146–#161) stays the top priority and runs in parallel.

| Todo | Fix | Needs |
|---|---|---|
| #264 | Blood On/Off pref (`?gore=0`, ⚙, localStorage) gating splats, pool, droplets, patron paint, screen blood and sleeves | — |
| #265 | Audio prefs: Sound persisted, Music and SFX volume sliders | — |
| #266 | Role goal at night and on the role chip | — |
| #267 | Lobby chat input | — |
| #268 | Reconnect: queue the last move, "Reconnected" toast | — |
| #269 | Offline template variety: 4–6 role-neutral lines per situation, no-repeat picker | FLT-0003 #146, FLT-3f2c3a1f #263 (written in the todo; Fleet can't link across tasks) |
| #270 | Bot language follows the table language (skip if #261 already did it) | FLT-3f2c3a1f #261 (written in the todo) |

#264–#268 are independent, so they can run in parallel sessions.
