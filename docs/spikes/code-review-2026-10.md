# Code review spike (todos #74, #85), 2026-10

## Question

The game was built fast across 5 phases without review. What bugs and performance problems does it have, which must be fixed now, and what follow-up work is needed?

## What I verified

- Baseline at commit b1ae9b0: `npm run typecheck` clean, `npm test` 88/88 passing.
- Method: full read of `server/` and `shared/` engine code; read-only review of `client/` and `client/scene/`; each finding below was checked against the code.

### Server: critical (fixed in this spike)

1. Crash risk: `server/room.ts` `botMove` (~line 373-382) throws `new Error('bot made illegal move')`. It runs inside timer callbacks (`onTimeout` ~359) and inside the un-awaited async `think` (~407-432). There is no `uncaughtException`/`unhandledRejection` handler anywhere, so one bad bot move kills the whole process and every room. `apply` (~314) also re-throws non-RuleError errors. Fixed in commit "Harden room timers and bot moves against exceptions"; regression test `tests/room-resilience.test.ts`.
2. Wrong host after a lobby seat is removed: `server/room.ts` `removeSeat` (~166-176) tests `host >= length` and `seats[host]?.bot` after the splice but before shifting the host index. E.g. host is seat 2 of 3, seat 0 leaves: host is reassigned to the old seat 1 instead of staying with the same player. Fixed in commit "Keep the right host when a lobby seat is removed"; regression test `tests/room-host.test.ts`.

### Server: minor (fixed)

- Game rooms whose humans all explicitly left stay until the 30-minute idle GC and count against maxRooms=50. Fixed in commit "Close game rooms once every human has left"; test `tests/room-empty.test.ts`.
- `botTalk` (`server/room.ts` ~439) sets the chat throttle even when the bot chose to stay silent. Fixed in commit "Bot chat throttle only on real lines; validate restored snapshots"; test `tests/bot-talk.test.ts`.
- `Room.restore` trusts the snapshot shape (seat count vs game players not validated). Fixed in the same commit: restore rejects an unknown stage, a seat/player count mismatch and an out-of-range host; tests in `tests/persistence.test.ts`.

### Client: state and UI bugs

- `client/main.ts` ~40-44 and the `left`/fatal-error handlers reset only the UI; `game.view`/`game.room` stay stale so `Game.update` (`client/game.ts` ~1105) keeps playing heartbeat/music mood/night lighting on the home screen.
- `client/game.ts`: `invShown`, `shot`, `pointAt`, `invFlight`, `pendingIndex` survive rematch/leave (lobby reset branch ~204-212 does not clear them); a leftover membership card keeps card mode on.
- `client/game.ts` `act()` (~585-595) does not refresh interactables, and `onRoom` (~185-186) resets `cardsDone`/`pickedPlayer` on every room message, so actions can be double-sent and the wrong card can animate to the discard pile.
- In-flight room messages after Leave re-show the room; chat logs (`client/ui.ts` ~262-277) and the leave-confirm dialog (~68-77) carry over to the next table.
- `client/ui.ts` ~126-129 copy-button label can stick; ~251 an old error timer can hide a newer error.
- `client/net.ts` ~22-28 try/catch swallows exceptions thrown by the message handler, not just JSON errors; up to 20 queued messages (including stale `act`s) are replayed after reconnect.
- `client/game.ts` ~265-290 duplicate envelope when a seat leaves and rejoins without a relayout.
- Checked and fine: no XSS (textContent/canvas only), seat indexing, chat log caps, no event replay on resume (server resume broadcasts no events).

### Client: rendering and performance

- `client/scene/characters.ts` ~146: one PointLight per patron, so up to 14 point lights; joins/leaves change the light count and recompile every material.
- `client/scene/world.ts` ~124: `preserveDrawingBuffer: true` always on (Playwright screenshots don't need it).
- GPU leaks: `world.ts` `setLayout` (~342) `tableGroup.clear()` without dispose; `Character.dispose` (`characters.ts` ~399) skips materials; envelope clones (`game.ts` ~285), game-over reveal cards (`game.ts` ~1046), chat-bubble SpriteMaterials (`characters.ts` ~246-251), `Board.setPowers` (`props.ts` ~114) materials never disposed; texture cache in `textures.ts` never evicts.
- Shadows: PCFSoftShadowMap at 1024^2 (`world.ts` ~128, ~145), ~35 shadow-casting meshes per patron; ~53 bottle draw calls (`world.ts` ~272-293); 26 large transparent smoke sprites (~326-334).
- Per-frame allocations: `client/interact.ts` ~72-89 `pick()` rebuilds a Map and array every frame; `computeTargets` (`game.ts` ~809-1052) allocates vectors/quaternions; new Raycaster per frame (`game.ts` ~100, ~980); `ui.setTimer` writes DOM every frame; `audio.ts` ~61-75 fills a fresh noise buffer per sfx call.

## Options

- A: fix everything in one pass.
- B (chosen): fix the two critical server bugs now (both can take the whole server down or break lobby control), and track the rest as an ordered follow-up task, measuring a perf baseline before the rendering work so optimisations are proven, not assumed.

## Risks and open questions

- Rendering numbers are from reading code, not measured; the first follow-up todo adds a `?perf` HUD to get real draw-call/fps numbers at 5 and 10 players.
- Removing the per-patron PointLight changes the look of the night-phase red glow; needs a visual check.
- Unverified: whether finished one-shot WebAudio nodes are garbage-collected in every browser.

## Follow-up tracking

Fleet task **LOCAL-bc050340** ("Code review follow-ups: client bugs & rendering perf") tracks the client work. The original follow-up task LOCAL-3071b063 no longer existed, so it was recreated. Its todos, in dependency order:

1. #86 Perf baseline `?perf` HUD; record 5/10-player numbers here.
2. #87 Reset client state on leave/left/fatal error; ignore room messages after leave.
3. #88 In-flight action guard (after #87).
4. #89 Small UI/net fixes (after #87).
5. #90 Dispose helper + GPU leak fixes + duplicate envelope (after #86).
6. #91 Replace per-patron PointLight (after #86).
7. #92 Per-frame allocation cleanup (after #86).
8. #93 Renderer settings: preserveDrawingBuffer, shadows, pixel ratio on resize (after #86, #91).
9. #94 Draw-call reduction via instancing/shared geometry, re-measured against #86 (after #90, #93).
