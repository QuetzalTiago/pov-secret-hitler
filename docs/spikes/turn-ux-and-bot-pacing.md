# Turn UX and bot pacing spike (todo #119), 2026-10

## Question

Players can't easily tell when it is their turn, and bots act much faster than a person would. What causes each, and what should change?

## What I verified

Each claim below was checked against the cited file and line.

### Bot speed

1. All bot timing is in `Room.schedule()` (`server/room.ts` ~487-510).
   - The delay is `config.botDelayMs` (default 1400, `server/config.ts` ~19) x 0.4 in vote/night (x1 otherwise), plus up to 80% random jitter.
   - Result: 0.56-1.0 s for votes and night acks, 1.4-2.5 s for everything else.
2. There is one bot timer per room, and it restarts after every applied action (`after()` -> `schedule()`, `server/room.ts` ~405-415).
   - Bot votes therefore land one at a time, about 0.6-1 s apart.
   - The first bot acts about 1.4 s after a phase opens.
3. Bots act before the client has finished showing what just happened:
   - vote reveal lasts 4.5 s (`client/game.ts` ~436, `until: this.now + 4.5`)
   - the nomination pointing arm lasts 2.5 s (~426)
   - the execution shot lasts 2.8 s (~556)
   - toasts last 5 s (`client/ui.ts` ~264)

   So a bot president discards while the vote reveal is still on screen.
4. Bot moves ignore the per-room chat queue from commit 38b7d98.
   - Each line waits 2.5-7 s before it is posted (`server/room.ts` `readMs`/`pumpChat`, ~684-727).
   - A bot's comment on a nomination can therefore appear after the vote it was about, or be dropped as stale (older than 25 s, ~712).
5. `think()` (`server/room.ts` ~513-538) awaits `decide()` (`server/brain.ts` ~16) before acting. That may call the Jev API with up to 3 s latency (`server/jev.ts` ~53, `config.jev.timeoutMs`, `server/config.ts` ~41), and this latency is added on top of the timer.
6. Human phase timers are 20-90 s (`PHASE_SECONDS`, `server/room.ts` ~42-54).
   - On expiry, `onTimeout` (~443-455) plays a heuristic move for every pending seat, humans included.
   - The human is never told this happened.
7. Tests and scripts rely on `botDelayMs` as the time scale:
   - `tests/server.test.ts` and `tests/persistence.test.ts` use 5 ms, and a full bot game must finish within 30 s.
   - room-resilience, room-empty, room-abandon and chat-pacing tests use 1e6-1e7 to freeze bots.
   - `scripts/perf.ts`, `scripts/jev-game.ts` and `scripts/preview.ts` set their own values.

   Any new pacing must stay proportional to `botDelayMs`.

### Turn UX

1. "Your turn" is signalled only by `#prompt.mine` and a gold timer.
   - `#prompt.mine` is a gold gradient with a "YOUR MOVE" header and a pulse (`client/style.css` ~80-95).
   - It is toggled by `UI.setPrompt` (`client/ui.ts` ~239) from `promptActive()` (`client/game.ts` ~245).
   - Waiting players see the same box, dark, at the same spot.
2. None of the committed e2e screenshots (`e2e/screenshots/*-acting.png`, e.g. `06-Ada-vote-acting.png`) show the gold style, so they are probably stale and predate the CSS. Follow-up #128 re-runs e2e to confirm.
3. No sound marks the start of your turn. The only per-actor sound is a tick in the last 5 s (`client/game.ts` ~1213-1219).
4. Nothing happens outside the tab.
   - There is no `document.title`, `Notification`, `visibilitychange` or favicon code in `client/`.
   - A player in another tab is auto-played after 45-90 s without being told.
5. Waiting players get no 3D highlight of who is acting. They infer it from the prompt text, the PRESIDENT/CHANCELLOR placards and where the characters' heads turn (`client/game.ts` ~1154-1189). Who has already voted appears only in the prompt text.
6. Clickable objects are hard to spot.
   - JA/NEIN cards, hand cards, the veto token and eligible players only show a hover tooltip (`client/interact.ts` ~121-123).
   - Veto is a clause at the end of the Chancellor prompt.
7. The camera can point away from the target. In screenshot `05-Dmitri-nominate-acting.png` the President must click a player while facing a wall, and nothing points back to the table.
8. The timer is small (22 px, top right, `client/style.css` ~68-70) and only turns urgent at 10 s or less.

## Options

Bots (chosen): give each bot its own "ready at" time, drawn when a phase opens, instead of the single restarting timer.

- **Settle time** for the event that opened the phase: vote reveal 4.5 s, nomination 2.5 s, execution 3 s, enactment 1.5 s, otherwise 1 s.
- **Think time** per phase:

  | phase | think time |
  |---|---|
  | night ack | 4-10 s |
  | nominate | 5-12 s |
  | vote | 3-9 s, independent per bot |
  | president/chancellor discard | 4-9 s |
  | veto | 4-8 s |
  | peek | 3-6 s |
  | investigate / special election / execute | 6-14 s |

- Both times are scaled by `botDelayMs / 1400`.
- The brain starts thinking immediately, so Jev latency hides inside the wait.
- A bot whose chat line is still queued waits for it to be posted, at most 5 s longer.
- A bot always acts at least 5 s before the phase deadline.

Rejected: just raising `botDelayMs`. That slows every move equally, keeps the votes serialized, and still ignores animations and chat.

UX, in order of value per effort:

1. A your-turn chime, plus a tab title and favicon flag while the tab is hidden.
2. A "time ran out, a move was made for you" notice.
3. A 3D glow under whoever is acting, plus face-down ballots for players who have voted.
4. An idle pulse on clickable objects, plus an edge-of-screen arrow when the target is off-screen.
5. A bigger timer that warns at 15 s.
6. Opt-in system notifications.

Coordination: task FLT-0001 (graphics polish) is in flight.

- Any glow or pulse uses its tween helper (todo #120) once it lands.
- It must respect that task's budget rule: no new lights, and new geometry merged or instanced.

## Risks and open questions

- The pacing numbers are a guess at human speed. Playtest todo #137 tunes them.
- Slower bots lengthen e2e runs. All pacing is kept proportional to `botDelayMs`, and the e2e config can lower it.
- With independent per-bot timers, several Jev calls may be in flight at once. The existing `config.jev.maxInflight` cap (6, `server/config.ts` ~42) and heuristic fallback cover this.
- System notifications need user permission, so they are opt-in only.

## Follow-up tracking

Task FLT-0002 "Turn UX and human-paced bots" (branch `turn-ux-bot-pacing`):

1. #128 Baseline: refresh e2e screenshots and assert `#prompt.mine` when acting. No dependencies.
2. #129 Per-bot human think time (new `server/pacing.ts`, per-seat `readyAt` in `room.ts`). No dependencies.
3. #130 Timed-out notice (`timedOut` event and client toast). No dependencies.
4. #131 Bots wait for animations to settle. Needs #129.
5. #132 Bots finish their queued chat line before acting. Needs #129.
6. #133 Your-turn cue (chime, tab title/favicon, bigger timer). Needs #128.
7. #134 Show who is acting in 3D (glow ring, voted ballots). Needs #128.
8. #135 Guide to the action (idle pulse, off-screen arrow). Needs #134.
9. #136 Opt-in system notifications. Needs #133.
10. #137 Playtest pacing and refresh screenshots. Needs #130, #131, #132, #135.
