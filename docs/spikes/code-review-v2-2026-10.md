# Code review v2 (todo #209), 2026-10

## Question

The game changed a lot since the first review (`docs/spikes/code-review-2026-10.md`, Oct 9): rigged glTF patrons, beats for big rule moments, play again with a series score, one-click quick start, belief-model bots and a personal record. What bugs, risks and structural debt does the current code have, and in what order should they be fixed?

## What I verified

Method: three read-only reviews at commit 38477ad (server and shared; client game and UI; scene, tests and tooling), then the load-bearing claims were re-checked against the code by hand. Items marked (verified) were confirmed in the code; (suspected) were not traced end to end.

### Server bugs

- S1 (verified) A page refresh at game over loses your seat. `disconnected()` calls `checkReady()` (`server/room.ts:147-157`, `402-406`), and `redeal()`/`rematch()` drop every human whose `conn` is null (`room.ts:417-421`, `442-446`), skipping the 60 s reconnect grace. Player A reloads while B readies up: the table re-deals at once and A's resume gets "Your seat is gone". `tests/room-playagain.test.ts:58` asserts this behaviour.
- S2 (verified) Bot think time leaks the President's hand. `choiceFactor(hand)` (`server/pacing.ts:40-42`, used at `room.ts:588`) makes a bot holding LLL or FFF act at 0.6x its delay, and `botTempo` is a stable hash of the bot's name, so a watcher can learn each bot's normal speed and tell when it had no real choice.
- S3 (verified) Bot memory can record a hand it never played. `noteMyHand` runs when the bot decides (`server/brain.ts:42-43`, `52-53`), not when the move is applied, and the President branch has no per-round dedupe (`shared/tracker.ts:88-92`). A rejected plan, or a held plan overtaken by `onTimeout` (`room.ts:531-533`, `646-655`), adds a second `passed` entry, which feeds false suspicion and false "proof" into tracker profiles (`tracker.ts:141-146`), `shared/belief.ts:169` and `server/botchat.ts:83`.
- S4 (verified) The host is not handed over when they leave during a game. `leave()` (`room.ts:182-200`) only moves host in the lobby; `isHost` compares `seatOf(conn)`, so at game over nobody can Deal now or go back to the lobby until every remaining human readies up.
- S5 (suspected) Old bot chat can post under the wrong name after a re-deal. `deal()`/`rematch()` do not clear `chatQueue`, pending `sayLater` timers or in-flight LLM replies (`room.ts:379-387`, `716-722`, `823-857`), which are keyed by seat index; a re-deal that drops a lower seat shifts the indexes.
- S6 (verified) The series score uses a plain object: a player named `constructor` or `toString` makes `wins[name] ?? 0` (`room.ts:494`) read an inherited function and store a string, and `validSeries` (`room.ts:1212-1216`) then wipes the whole series on restore. Also: `ready` is not saved in `snapshot()` (`room.ts:292-302`), and restore accepts `stage:'game'` with `game:null` (`room.ts:308-309`).
- S7 (suspected) Abuse: there is no per-IP limit on connections or creates (`server/index.ts:140-143`, `196-201`), so one client can fill `maxRooms=50` (`server/config.ts:29`) in under a second; the LLM budget `written` resets every deal (`room.ts:669`, `950-952`), so quick start, chat and leave in a loop has no spend ceiling.
- S8 (suspected) Prompt injection: `writeReply` puts raw human chat into the prompt (`server/bottalk.ts:387`) while a Fascist bot's prompt lists its teammates (`bottalk.ts:217-224`); `sanitize` (`bottalk.ts:321-338`) only blocks the bot revealing its own role.

### Client bugs

- C9 (verified) The investigation card never leaves your hand: `invShown` (`client/game.ts:722`) is cleared only by clicking it or by `clearTable()`, so `cardMode()` (`game.ts:865`) stays true and the view stays frozen into the next phase and the next game. Already tracked as FLT-0004 #178(c); #178(d) (chat log can't scroll, `client/style.css:382`, under `#hud { pointer-events: none }`) is still open; #178(b) (victory skip under pointer lock) looks fixed by `client/main.ts:116` and `client/interact.ts:152` but has no test.
- C10 (verified) The HUD spoils what the 3D table holds back: `client/hudmodel.ts:289-291` reads the live liberal, fascist and tracker counts while the board follows `shown`, and at game over `hudmodel.ts:254` sets the winner title and `hudmodel.ts:278` reveals every `knownRole` while `rolesHeld` still hides them in 3D.
- C11 (suspected) Leave cleanup gaps: the enact `setTimeout` (`game.ts:690`) is never stored or cleared, so leaving right after an enact can show the Extrablatt over the home screen; `ui.resetTable()` (`client/ui.ts:330-341`) does not hide `#enact` or clear `#toasts`; `game.reset()` (`game.ts:427`) leaves patrons and played vote cards in the scene.
- C12 (suspected) Any non-fatal server error (such as a chat rejection) calls `actionRejected()` (`main.ts:127`) and clears the in-flight action guard.

### Earlier review items

- Fixed: #87 reset on leave (mostly), #88 in-flight guard, #89 small UI/net fixes, #90 dispose and leaks, #91 per-patron light.
- Partly fixed: #92 per-frame allocations, #93 renderer settings (`preserveDrawingBuffer` gone, shadow casters not reduced).
- Open: #94 draw calls. #93 and #94 stay in task LOCAL-bc050340.

### Structure and hygiene

- `server/room.ts` (1217 lines) splits cleanly: table talk (~500 lines, `room.ts:662-1161`), bot scheduling (`538-656`), phase timer (`498-536`), series and snapshot. `client/game.ts` (1522 lines): event copy (onBeat strings and `POWER_TEXT`, `game.ts:49-54`, `561-760`) can become a pure module like `hudmodel.ts` and `beats.ts`.
- Dead code: `tension` and `SUPPORT` imports and write-only `botStats` in `room.ts` (`14`, `18`, `89`); write-only `this.tiles` in `game.ts`; the `enactBanner` re-export in `ui.ts:12`; several exported types nothing imports. The role-to-party mapping is repeated in `game.ts` and `ui.ts` although `shared/rules.ts` exports `partyOf`. `rand(seed)` is duplicated in `client/scene/portraits.ts:20-26` and `client/scene/textures.ts:111-117`.
- `tsconfig.json` is strict but has no `noUnusedLocals`/`noUnusedParameters`; there is no linter.
- Wall-clock tests that can fail on a loaded machine: `tests/bot-pacing.test.ts` (real `Date.now()` bounds, busy polls), `tests/room-abandon.test.ts` (~4 s of real sleeps), `tests/room-resilience.test.ts`, `tests/persistence.test.ts`. Only 2 test files use fake timers.
- Per-frame allocations left: `computeTargets` in `game.ts`, `gunPose()` in `client/scene/rigged.ts:475-481`, `client/scene/smoke.ts:201`, `Layout.eye()` in `client/scene/world.ts:91`.
- Accessibility: dialogs lack `role="dialog"`/`aria-modal`, Esc does not cancel the leave confirm, no `aria-live` on toasts or chat.
- Checked and fine: GPU disposal (`disposeObject`, LRU texture cache of 64), every storage call wrapped in try/catch, strict protocol parsing (size cap, control characters stripped, seat stamped by the server), `shared/view.ts` leaks no roles, deck or votes, no `any` or `@ts-ignore` in production code, CI runs typecheck, test, simulate and build.

## Options

- A: one big cleanup pass. Rejected: `room.ts` and `game.ts` are also being changed by FLT-0004 #183 and FLT-0003, so a big pass would conflict everywhere.
- B (chosen): fix the verified server bugs first as small test-first commits (S1, S4, S2, S3, S6, then S5, S7), then the client HUD and leave fixes (C10, C11), then pull table talk out of `room.ts` and event copy out of `game.ts`, and do the hygiene (dead code plus the two tsconfig flags, fake timers, allocations, accessibility) last. No linter: the two tsconfig flags catch the dead code that matters at no extra tooling cost.

## Risks and open questions

- S5, S7, S8, C11 and C12 are suspected, not traced end to end; the S8 and C12 todos start by proving the problem with a test.
- #178(b) looks fixed but needs a human check in the live game.
- The `room.ts` fixes and FLT-0004 #183 (Pace option) touch the same lines in `room.ts` and `server/pacing.ts`; whichever lands second rebases.
- The procedural `Character` in `client/scene/characters.ts` (~540 lines) is a kept fallback for `?chars=old` that duplicates logic in `rigged.ts`; removing it is a product decision, not tracked.

## Follow-up tracking

Fleet task **FLT-0007** ("Code review v2 follow-ups"), todos in dependency order:

1. #212 Seat survives a refresh at game over (S1).
2. #213 Host handover on leave during a game (S4), after #212.
3. #214 Bot think time independent of the hand (S2).
4. #215 Record bot hands from the applied action (S3).
5. #216 Series score safe for any name, snapshot `ready`, reject game without game (S6), after #212.
6. #217 Clear stale bot chat on re-deal (S5), after #213.
7. #218 Per-IP create limit and cumulative LLM budget (S7), after #216.
8. #219 Verify, then fix, prompt injection (S8).
9. #220 HUD follows the beats (C10).
10. #221 Leave cleanup (C11).
11. #222 Verify, then fix, the in-flight guard release (C12).
12. #223 Extract table talk from `room.ts`, after #212, #213, #216, #217, #218.
13. #224 Extract event copy from `game.ts`, after #220, #221.
14. #225 Fake timers in wall-clock tests, after #214.
15. #226 Per-frame allocation leftovers (after #224).
16. #227 Cheap accessibility.
17. #228 Dead code, `partyOf`, tsconfig unused flags, last.
