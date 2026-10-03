# Plan: "Smoke & Ballots" — 3D first-person online Secret Hitler (Liar's Bar style)

## Context
Greenfield build in `C:\Users\Tiago\pov-secret-hitler` (directory is empty, not a git repo).
Environment: Windows 11, Node 22.21, npm 10.9, git 2.35, winget available, **cloudflared not installed**.
Goal: playable internet-hosted multiplayer 3D Secret Hitler with a server-authoritative pure rules engine,
diegetic Three.js UI, bots, tests, 2,000-game simulation, a 5-client Playwright smoke test, and `npm run host`
that prints a public trycloudflare URL. The user asked to work autonomously, so no questions; decisions go to DECISIONS.md.

## Repo layout (single package, npm workspaces avoided for simplicity)
```
package.json  tsconfig.json  vite.config.ts  playwright.config.ts
PLAN.md  DECISIONS.md  README.md  LICENSE (CC BY-NC-SA 4.0)
shared/   engine.ts (pure reducer), types.ts, rules.ts (tables), rng.ts (seeded mulberry32),
          view.ts (per-player view projection), protocol.ts (msg schemas + validators)
server/   index.ts (express+ws, binds 127.0.0.1), rooms.ts (room mgr, codes, tokens, caps),
          room.ts (game loop: timers, bots, disconnect takeover, chat), bot.ts (random-legal + light heuristics),
          ratelimit.ts
client/   index.html, main.ts, net.ts, lobby.ts (DOM overlay), credits.ts,
          scene/ (bar.ts, table.ts, characters.ts, props.ts: envelope, placards, ja/nein cards, policy cards,
                  board, revolver; lighting.ts; textures.ts canvas-gen; camera.ts mouse-look clamp),
          interact.ts (raycast hover/click + prompt), audio.ts (WebAudio synth), chat.ts (bubbles),
          animator.ts (tween queue driven by server events), testhooks.ts (window.__sh for Playwright)
tests/    engine.test.ts, view-leak.test.ts, protocol.test.ts (vitest)
scripts/  simulate.ts (2,000 games), host.ts (build → server → cloudflared → banner → WS check)
e2e/      smoke.spec.ts (5 contexts, screenshots to e2e/screenshots/)
```
Deps: express, ws, three; dev: typescript, vite, tsx, vitest, @playwright/test, @types/*.

## Engine (shared/engine.ts) — pure `reduce(state, action, rng?) -> {state, events}`
- State: players (id, seat, alive, role, party), deck/discard/drawn arrays, liberal/fascist tracks,
  electionTracker, presidentIdx, specialElectionReturnIdx, lastElected {pres, chanc}, nominee, votes,
  phase enum: `lobby | night | nominate | vote | legislativePresident | legislativeChancellor | vetoPending |
  executive(peek|investigate|special|execute) | gameOver`, investigated set, winner+reason, seed-based RNG state stored in state for determinism.
- All rules from spec: role tables 5–10p, knowledge rules, deck 6L/11F, reshuffle when <3, rotation clockwise,
  term limits (≤5 alive → only last chancellor barred), tie fails, chaos at 3 (top card, no power, reset tracker
  and term limits), presidential powers by bracket, investigate party not role & no repeats, special election
  resume from original president's left, veto after 5F (chancellor proposes, president accepts→discard both,
  tracker+1, possibly chaos; refuses→chancellor must enact), wins (5L, Hitler shot, 6F, Hitler elected chancellor after ≥3F).
- `legalActions(state, playerId)` used by validator, bots, simulation. Every action validated; illegal → error, state unchanged.
- Events list (e.g. `voteRevealed`, `policyEnacted`, `playerExecuted`) drive client animations; events also filtered per player.

## View projection (shared/view.ts)
`viewFor(state, playerId)` builds the only thing a client ever receives: own role; teammates only per knowledge rules;
drawn cards only to the holder at that phase; votes hidden until all cast (only "has voted" flags); peek result only to
president; investigation result only to investigator; deck shown as count only; discard count only. Roles of all
revealed at gameOver. Spectators/dead get the same restricted view. Events also passed through `eventFor(playerId)`.

## Server
- `HOST=127.0.0.1`, `PORT` default 3000; serves `dist/client` statically + `ws` on same http server (`/ws`).
- Rooms: 4-letter codes (no ambiguous letters), max 50 rooms, max 10 seats, max 200 connections total, max 4 per IP
  (IP from `CF-Connecting-IP` only when request came via loopback tunnel—documented). Idle rooms GC'd after 30 min.
- Messages JSON, max 2 KB (`maxPayload`), token-bucket 20 msg/s burst, 5/s chat; hand-written validators per type
  (no zod dependency needed); chat 200 chars, sanitized as text (client uses textContent / canvas).
- Reconnect: server issues random 128-bit token per seat; client stores `{room, token}` in localStorage; on reconnect seat
  is reclaimed and the bot (if any) relinquished.
- Disconnect >60s → bot drives the seat. Phase timers (e.g. nominate 60s, vote 45s, legislative 60s, power 60s)
  → on expiry the server performs a random legal action for the stalled player. Night phase 10s auto.
- Dead players: chat rejected server-side.
- Bots: pick from `legalActions` with simple party-biased heuristics, small think delay.

## Client (Three.js, Vite)
- Dim bar: wood table (canvas wood texture), hanging lamp with flicker, fog + floating smoke sprites, bottles/shelf boxes.
- Seats placed around oval table with local player always at near seat (rotate seat order by own index).
- Low-poly original characters (capsule body, box head, hat variations, color-coded coats), idle breathing/sway,
  heads lerp toward current actor, slump when dead.
- Diegetic flow: envelope on table → click to open → role card rises; night: lights drop, fascists see teammates tinted red;
  placards slide; president clicks a character to nominate; Ja/Nein cards in front—click to slam face-down, flip together on reveal;
  policy cards drawn into hand (fan near camera), click one to toss to discard, rest slide to chancellor;
  board in center with liberal/fascist tracks (power icons per bracket), election tracker token; revolver for execution with aim + gunshot,
  camera shake, flash; investigate = party card slid privately; peek = 3 cards shown privately.
- Interaction: raycaster on `interactable` objects, emissive hover highlight, bottom prompt "Waiting for X to nominate a Chancellor".
- Chat input (Enter), speech bubbles as canvas sprites above heads; WebAudio synthesized sounds (card slap, slide, gunshot noise burst, tick, ambient hum).
- Lobby/credits as HTML overlay; credits attribute Mike Boxleiter, Tommy Maranges, Max Temkin, Mac Schubert (Goat, Wolf & Cabbage), CC BY-NC-SA 4.0.
- `window.__sh` test hooks: state snapshot, `act(action)` which uses the same code path as clicks (dispatch via interact layer), `ready` flags.

## Phases (commit after each; `git init` first)
1. Scaffold + PLAN.md + DECISIONS.md + LICENSE; engine + unit tests (every listed rule) → commit.
2. View projection + leak tests + simulation script (2,000 games across 5–10p, invariants: 17 cards conserved, phase legality, winner always, no throw) → commit.
3. Server: rooms, protocol validation, rate/size caps, tokens/reconnect, timers, bots, chat → commit (with a node WS integration test).
4. Client 3D scene + lobby + interactions + animations + audio + chat → commit.
5. Playwright smoke: 5 contexts join one room, play full game via `__sh` hooks, screenshots; view them and fix rendering → commit.
6. `npm run host` (scripts/host.ts): detect OS; if no cloudflared → try `winget install --id Cloudflare.cloudflared` (Windows),
   `brew install cloudflared` (mac), download binary to `./bin` (linux) — else print exact instructions; spawn tunnel, regex
   `https://[a-z0-9-]+\.trycloudflare\.com`, print banner, verify HTTP 200 and a WS round-trip through the tunnel. README → commit.
7. Run `npm run host`, fetch public URL, confirm, report link.

## Verification
- `npm test` (vitest: engine rules, view leaks, protocol validation).
- `npm run simulate` (2,000 games, prints stats; non-zero exit on invariant failure).
- `npm run e2e` (Playwright, 5 contexts, game completes, screenshots inspected with Read tool, fixes applied).
- `npm run host` → banner URL; fetch URL (HTTP 200) + WS ping through tunnel.
