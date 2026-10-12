# Game design review (todo #145), 2026-10

## Question

How does POV Secret Hitler play, judged as a game rather than as code, and which changes would raise the experience most for the least cost?

The review covers 8 design dimensions: clarity, decision quality, feedback, pacing, social deduction depth, bot believability, onboarding and atmosphere.

## Method and scope

- Evidence came only from:
  - the code (`client/`, `server/`, `shared/`)
  - the unit tests (`tests/`)
  - the earlier spikes in this folder
  - the e2e screenshots that were last committed before 9d8d5d9 (`git show e2651e6:e2e/screenshots/<name>.png`)
- There were no browser, Playwright or perf runs. The human checks visuals in the live game.
- The skills used were `game-design-review`, `player-persona-playtest`, `social-deduction-design` and `game-feel-juice`.
- **Out of scope here, because it is already planned elsewhere and only linked:**
  - **#142, UI plan (in flight).** HUD model; status bar with policy pips and power icons; phase stepper; action card with a verb pill and timer; roster with PRES/CHANC/NOMINEE, voted and term-limited badges; the Chancellor clicks the policy to *enact*; a wider camera, keyboard look, a glance at the nominating President, and off-screen markers.
  - **FLT-0001:** #123 card motion, #126 game-over cinematic, #127 perf gate.
  - **FLT-0002:** #133 your-turn chime and tab title, #135 idle pulse and off-screen arrow, #136 notifications, #137 pacing playtest.

## What I verified

Each item was read in the cited code. The four marked with ✔ were re-read line by line for this review.

1. **The engine is faithful to the board game** (`shared/rules.ts`, `shared/engine.ts`).
   - Player counts, role splits and the power tracks for 5–6, 7–8 and 9–10 players are correct.
   - Veto unlocks at 5 Fascist policies (`engine.ts:95`).
   - Term limits: the last Chancellor is always barred; the last President only while more than 5 players are alive (`engine.ts:99-106`).
   - Chaos policy at a tracker of 3 (`engine.ts:254-268`).
   - Hitler elected Chancellor with 3+ Fascist policies wins for the Fascists (`engine.ts:326-328`). Shooting Hitler wins for the Liberals (`engine.ts:393`).
   - No deviations found, so the rules are not where the fun is lost.
2. ✔ **The public record is almost empty.**
   - `GameView` carries only the *latest* election's votes (`shared/view.ts:36,92`), the current and last government, and the board counts.
   - There is no government history, per-player vote history, enacted-by or claims, and the client keeps no log either.
   - Toasts fade after about 5 s (`client/ui.ts:262-264`). The vote reveal lasts 4.5 s (`client/game.ts:449`).
   - Bots, meanwhile, keep a full memory (`shared/tracker.ts`), so **the humans are the ones playing with less information**.
3. **There is no claim mechanism.**
   - Bots "claim" only through chat lines (`server/botchat.ts:71-146`). Claims never enter state, and nobody, bot or human, can check one against another.
   - Humans have free-text chat only (`client/ui.ts:97-119`).
   - The chat log is `overflow:hidden` and cannot be scrolled (`client/style.css:104`).
4. ✔ **Bots leak their roles through their behaviour.**
   - A nominated bot's small talk depends on its role: Fascists say "Trust me." / "You won't regret it.", Liberals say "I won't let you down." (`server/botchat.ts:204-207`).
   - The heuristic scores make Fascists *always* discard L and enact F, Hitler included (`shared/smartbot.ts:176,190`). The ±0.6 noise in `server/brain.ts` cannot flip a 2-vs-0 score.
   - Fascists vote JA on nearly every government (`smartbot.ts:161-162`).
5. **Suspicion is never driven by talk.**
   - `tracker.ts:113-163` updates only from policies, JA votes on F governments, your own hands and your own investigations.
   - Claims, nominations, failed votes, executions and human chat do not count.
   - Human chat changes only bot mood and rapport (`server/room.ts:839-841`).
6. ✔ **Bots cannot answer a human without an LLM.** `botsReactTo` returns early when `!this.canWrite()` (`server/room.ts:847`), and so does the mood tick (`room.ts:911`). Without a key, a solo player is talking to a wall.
7. ✔ **`feel()` has two timing bugs.** It runs after the engine has already cleared state:
   - `g.nominee` is null once the vote resolves, so the "rejected nominee holds a grudge" branch never fires (`room.ts:1047`).
   - `g.chancellor` is null after an enactment, so Liberal governments never earn rapport (`room.ts:1063`).
8. **Danger is not shouted.**
   - "Hitler as chancellor wins from the 4th slot on" is a caption at 55% alpha on the board texture (`client/scene/textures.ts:405`).
   - The fact that a Chancellor elected at F≥3 is *confirmed not Hitler* is never shown.
9. **Feel is strong at the top and has small gaps.**
   - The execution has the full vocabulary (`game.ts:573-587`; `world.ts:712-753`).
   - The vote reveal flips cards, plays a voice and makes characters nod (`game.ts:446-458`).
   - Special election plays no sound (`game.ts:569-572`). `sfx.chat` is defined but never called (`client/audio.ts:238`).
   - With a free cursor, the first click on the canvas only takes the pointer lock (`client/interact.ts:56-59`).
   - The enact stamp waits about 650 ms for the flight (`game.ts:521`).
10. **Pacing.**
    - Bot think times are humane and scaled by `botDelayMs` (`server/pacing.ts`).
    - There is no talk beat: the next President nominates as soon as their think time ends, often before the claim lines are posted.
    - An AFK human who is still connected costs the full phase timer (45–90 s) on every phase they own, because only a disconnect hands the seat to a bot (`room.ts:451-453`, `154-174`).

## Loop map (as lived)

| Step | What the player sees | Decision | Wait | How they learn it is their turn |
|---|---|---|---|---|
| Lobby | DOM seat list, host's +Bot/Deal | host: when to start | until the host deals | n/a; no rules button here (only Credits) |
| Night | Lights drop, a glowing envelope, the role card rises; Fascists see teammates glow | none (ack) | up to 20 s for the slowest human | gold "YOUR MOVE" prompt; the envelope pulses |
| Nominate | Placards, gold rings under the acting seat; the NPC President sweeps a finger | President: who is Chancellor | 5–12 s bot think | gold prompt + ring; the President may face a wall (#142 fixes this) |
| Vote | JA/NEIN cards lift; face-down cards drop as others vote | JA/NEIN, **with no history to inform it** | 3–9 s per bot + 4.5 s reveal | gold prompt; your cards glow |
| Vote reveal | Cards flip at 1.5×, a Ja/Nein voice, nods; a toast | none | 4.5 s, **then gone** | n/a |
| Legislate (President) | 3 cards drop into your hand; hover glow | which to discard | 4–9 s bot | gold prompt |
| Legislate (Chancellor) | 2 cards; VETO token at F=5 | which to enact (#142 flips the verb) | 4–9 s bot | gold prompt |
| After enactment | The card flies to the board, a stamp, a coloured toast | **nothing: no claim step** | the next President acts at once | n/a |
| Power | Purple toast; investigate slides a card; execution is a full set piece | President's target | 6–14 s bot | gold prompt |
| Game over | 3D role cards stand up; a panel with the winner, reason, and roles | none | n/a | n/a; **no recap of who lied** |

The loop's mechanics are complete, but its *information* loop is broken. Each round produces evidence (votes, governments, policies, claims), and none of it survives to the next decision.

## Scores

| Dimension | Score | Now | A 10 looks like | Cheapest big win |
|---|---|---|---|---|
| 1. Clarity | 5 | Gold prompt and rings show the actor, but the Hitler-zone danger is invisible and "confirmed not Hitler" is never shown | Any player can say who acts, what's at stake ("this vote can end the game") and what just happened, at a glance | #142 (in flight), then a Hitler-zone alarm in the action copy (fix 5) |
| 2. Decision quality | 3 | Votes and nominations are made blind; the record vanishes in 5 s | A one-key ledger of every government, every vote and every claim, the way a veteran table remembers | Public history in the view (fix 3) + a ledger panel (fix 4) |
| 3. Feedback & feel | 7 | Execution and vote reveal are excellent; special election is silent; the first click is swallowed; chat makes no sound | Every action is acknowledged within 100 ms; every power has its own beat | Juice-gap pack (fix 15); card motion is FLT-0001 #123 |
| 4. Pacing | 6 | Humane bot timing; no talk beat; an AFK human stalls each phase for 45–90 s | Short beats for talk after each enactment; AFK seats hand off quickly | AFK escalation (fix 12), talk beat (fix 13) |
| 5. Social deduction depth | 3 | No claims, no accusations; lies are free and unrecorded | Claims are recorded and contested, conflicts are visible, and lying is a skill with risk | Structured claims (fixes 6–9) |
| 6. Bot believability | 4 | Role tells in the small talk and in play; mute to humans without an LLM | Bots bluff, hesitate, accuse from evidence and answer you even offline | Remove the tell (fix 1), offline replies (fix 11), cover play (fix 10) |
| 7. Onboarding | 4 | A 6-paragraph rules panel, prompts and tooltips | The first game teaches as it goes: "why" hints, the danger rule spelled out at the moment it matters | First-game coach (fix 16), after #142 |
| 8. Atmosphere & POV | 8 | Speakeasy, patrons, a revolver set piece, hands up at gunpoint, music moods | The table feels alive between beats: glances, murmurs, reactions to claims | Mostly in FLT-0001 and #140; bots reacting to claims (fix 9) adds life |

**Overall: 40/80.** The game looks and feels better than it *plays*. The atmosphere is ahead of the deduction.

## Persona notes

- **First-timer.**
  - Night is clear and atmospheric.
  - At nominate they don't know why anyone should be distrusted, and at vote they slam JA every time.
  - At F=3 they elect a Chancellor without knowing that this could end the game. Nothing on screen says so beyond board text. **Confusion + missed drama** (fixes 5, 16).
- **Veteran.**
  - Wants to ask "who voted JA on the government that passed two Fascists?" The answer exists only in their own memory, because the reveal lasts 4.5 s. **Blindness** (fixes 3, 4).
  - There are no claims to compare, so the core veteran skill of catching conflicts has nothing to work on (fixes 6–9).
- **Fascist liar.**
  - Can only bluff in free text, and a bluff carries no weight because nothing records it.
  - Their Fascist bot teammates, meanwhile, out themselves with "Trust me." and 100% F enactments. **The lie has no stage and the team has no cover** (fixes 1, 7, 10).
- **Solo vs bots.**
  - The table reads well, but bots ignore what they say unless an LLM key is set.
  - Bots never react to claims, so the solo human is the only detective at the table.
  - Wins come from reading the tells, not from deduction (fixes 1, 9, 11).
- **Distracted / small screen.**
  - Comes back mid-game with no history and no way to scroll the chat (fix 4).
  - If they AFK, the whole table waits 45–90 s on every phase they own (fix 12).

## Ranked fixes

Ranked by (impact × frequency) / cost. Must = do first, Should = next, Could = backlog. ⚖ = changes how bots play, so check `npm run simulate` win rates before and after.

| # | Fix | Tier | Files | Needs |
|---|---|---|---|---|
| 1 | Remove the bot role tell in nomination small talk | Must | `server/botchat.ts` | — |
| 2 | Fix the `feel()` timing bugs (grudge, Liberal rapport) | Must | `server/room.ts` | — |
| 3 | Public game record: `history` of governments, votes, results, powers in state and view | Must | `shared/engine.ts`, `types.ts`, `view.ts` | — |
| 4 | Ledger panel (one key): governments × votes, your private investigation results | Must | `client/ledger.ts` (new), `ui.ts`, `index.html`, `style.css` | 3, #142 tokens |
| 5 | Hitler-zone alarm in the action copy at F≥3 + "not Hitler" badge | Must | `client/hudmodel.ts` (#142) | 3, #142 |
| 6 | Claims record: `claim` message, validated, stored on the history entry, conflicts derived | Must | `shared/protocol.ts`, `server/room.ts`, `shared/view.ts` | 3 |
| 7 | Quick-claim chips for the President/Chancellor/investigator; conflicts marked in the ledger | Must | `client/game.ts`, `ui.ts`, `ledger.ts` | 4, 6 |
| 8 | Bots post structured claims (truth or lie, from the existing intents) | Should | `server/botchat.ts`, `server/room.ts` | 6 |
| 9 | Bots read claims: conflicts and claimed investigations move suspicion | Should | `shared/tracker.ts` | 8 |
| 10 | ⚖ Fascist cover play: sometimes pass L or vote NEIN early to blend in | Should | `shared/smartbot.ts` | 9 |
| 11 | Bots answer humans without an LLM (template replies) | Should | `server/room.ts`, `server/bottalk.ts` | — |
| 12 | AFK escalation: after 2 timeouts in a row, bot-play the seat until the human acts | Should | `server/room.ts` | — |
| 13 | Talk beat after enactment: the next nomination waits for claim lines | Should | `server/pacing.ts` | 8 |
| 14 | Game-over recap: timeline with true hands against claims ("who lied") | Should | `server/room.ts`, `client/ui.ts` | 4, 6; coordinate with #126 |
| 15 | Juice gaps: special-election beat and sound, chat sound, first click activates, immediate enact ack | Should | `client/game.ts`, `interact.ts` | — |
| 16 | First-game coach hints + Rules button in the lobby | Could | `client/hudmodel.ts`, `index.html` | #142 |
| — | Point/accuse gesture at a seat (bots react) | Could | backlog | — |

## Options

- **Recommended: restore the information loop first (fixes 3–7), then make the bots use it (8–10).**
  - Claims live in the Room and the history, not in the rules engine. They are table talk, not rules, so `engine.ts` legality and `npm run simulate` balance are unaffected until fix 10.
- **Rejected: lean on the LLM for deduction.** It is optional (no key, a 400-call cap, a circuit breaker), and it leaves humans without a record.
- **Rejected: a mandatory discussion phase with a timer.** Most players at a bot table want flow. A short bot-side talk beat (fix 13) and a ledger give the benefit without forcing a pause.

## Risks and open questions

- **Fix 10 changes win rates.** Run `npm run simulate` before and after, and keep Liberal/Fascist within about ±5 points of today.
- **Claims open a new lie surface.** Validate only *shape* (who can claim and when), never truth, or fascists can't lie. Show conflicts, never a verdict.
- **History grows the view.** At most about 20 entries per game; keep the entries compact. `tests/view-leak.test.ts` must stay green: history holds no hidden hands until gameOver (fix 14).
- **Overlap with #142 and the ledger UI.** The ledger reuses #142's tokens and roster. If #142's roster already shows past votes per player, fix 4 shrinks to the governments table.
- **Open question for the human:** should the ledger be always on screen (a side strip) or one keypress away? This review assumes one keypress, to protect the POV view.

## Follow-up tracking

Task **FLT-0003** "Game design: table record, claims and honest bots" (branch `design-deduction`). Each todo is one commit. "Needs" lists what must land first.

| Todo | Fix | Needs |
|---|---|---|
| #146 | 1. Remove the bot role tell | — |
| #147 | 2. `feel()` timing bugs | — |
| #148 | 3. Public game record (`history`) | — |
| #149 | 11. Bots answer without an LLM | — |
| #150 | 12. AFK escalation | — |
| #151 | 15. Juice gaps | — |
| #152 | 4. Ledger panel | #148, #142 (FLT-3f2c3a1f) |
| #153 | 5. Hitler-zone alarm + "not Hitler" badge | #148, #142 (FLT-3f2c3a1f) |
| #154 | 6. Claims record | #148 |
| #155 | 7. Quick-claim UI | #152, #154 |
| #156 | 8. Bots post structured claims | #154 |
| #157 | 9. Bots read claims | #156 |
| #158 | 13. Talk beat after enactment | #156 |
| #159 | 14. Game-over recap | #152, #154 |
| #160 | 10. ⚖ Fascist cover play | #157 |
| #161 | 16. First-game coach | #153, #142 (FLT-3f2c3a1f) |

- The point/accuse gesture is in the Fleet backlog.
- Fleet cannot link dependencies across tasks, so the dependencies on #142 are written in the todo text.
