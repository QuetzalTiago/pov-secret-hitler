# POV Secret Hitler

**Play at [povsecrethitler.app](https://povsecrethitler.app)**

A first-person, online multiplayer 3D adaptation of the social deduction board game
[Secret Hitler](https://www.secrethitler.com/) for 5–10 players. You sit at a table in a dim, smoky bar and do
everything physically: open your role envelope, point at a player to nominate them, slam a **JA!** or **NEIN**
ballot, pass policy cards across the table, and, when the time comes, pick up the revolver.

An unofficial, non-commercial fan project. Not affiliated with or endorsed by the creators of Secret Hitler.

## Features

- **Complete official rules** for 5–10 players: roles and knowledge, term limits, election tracker and chaos
  policies, all presidential powers, veto, and every win condition.
- **Diegetic 3D table** (Three.js): role envelope and night phase, placards, ballots that flip together,
  policy cards in hand, a board with both tracks, a revolver with aiming, characters who turn their heads,
  point, and slump when executed.
- **Online play**: create a table, share an invite link (`/?join=CODE`), fill empty seats with bots.
  Reconnect with the same seat after a refresh; a bot covers for anyone gone for more than 60 seconds.
- **Bots that reason**: each bot tracks the game from its own seat (votes, governments, what it saw in its
  own hand), keeps suspicion scores, and makes decisions with the [Jev](https://docs.typesafe.ai) decision model
  when an API key is configured, falling back to a built-in strategy. They also talk: Liberals tell the
  truth, Fascists lie when it helps.
- **Server-authoritative and leak-proof**: clients only ever receive their own player's view; every message
  is validated, rate-limited and size-capped.
- **Persistent**: rooms are saved to SQLite, so a server restart doesn't end games in progress.
- **Sound**: synthesized effects plus a few openly licensed recordings and music (see credits).

## Quick start

Requires **Node.js 22.5+** (for the built-in `node:sqlite`).

```bash
git clone https://github.com/QuetzalTiago/pov-secret-hitler.git
cd pov-secret-hitler
npm ci
npm run build      # build the client into dist/client
npm start          # http://127.0.0.1:3000
```

Open a table, press **+ Bot** until there are at least 5 seats, and **Deal the roles**. To play with friends on
one machine, use separate browser profiles or private windows (the reconnect token lives in localStorage).

### Development

```bash
npm run dev          # server with auto-reload (port 3000)
npm run dev:client   # Vite dev server with hot reload; proxies /ws to port 3000
```

Useful URL flags: `?nolock` (don't capture the mouse, handy for testing), `?perf` (performance overlay).

### Smarter bots (optional)

Copy `.env.example` to `.env` and set `TYPESAFE_API_KEY`. The key is read only by the server and only sent to
`api.typesafe.ai`. Without it, bots use the built-in strategy. Tests never use the key.

## Testing

```bash
npm run typecheck   # TypeScript
npm test            # unit + integration tests (engine rules, view leaks, protocol, server, bots, persistence)
npm run simulate    # 2,000 full games with random and strategic bots, asserting invariants
npm run e2e         # Playwright: 5 browser players complete a game through the real 3D UI
```

## Hosting

`npm run host` builds the client, starts the server on `127.0.0.1` only, and exposes it with a
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Without
configuration it opens a free random `trycloudflare.com` URL (installing `cloudflared` if needed). For your own
domain, create a named tunnel and a git-ignored `tunnel.json`:

```json
{ "name": "<tunnel name>", "hostname": "example.com", "config": "<path to cloudflared config.yml>" }
```

Rooms are stored in `data/rooms.db` (git-ignored) when running `npm start` or `npm run host`.

## Project layout

| Path | What |
|---|---|
| `shared/` | Pure rules engine (`engine.ts`), per-player views (`view.ts`), protocol + validation, bot strategy and memory. No I/O. |
| `server/` | Express + WebSocket server, rooms, bots and Jev client, persistence. |
| `client/` | Three.js client: scene, characters, props, interaction, audio, UI. |
| `tests/` | Vitest suites. |
| `scripts/` | Simulator, hosting, dev helpers. |
| `e2e/` | Playwright smoke test. |
| `PLAN.md`, `DECISIONS.md`, `docs/` | Design notes and decisions. |

## Contributing

Contributions are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and please follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md).

## Credits & license

**Secret Hitler** was created by Mike Boxleiter, Tommy Maranges and Max Temkin, with illustrations by Mac
Schubert, and is published by Goat, Wolf, & Cabbage under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This adaptation uses no art from the
original game.

This project is licensed under the same **CC BY-NC-SA 4.0** license (see [LICENSE](LICENSE)): you may share and
adapt it for **non-commercial** purposes, with attribution, under the same license.

Third-party assets keep their own licenses:
- Sound effects: [client/sfx/CREDITS.md](client/sfx/CREDITS.md) (CC0 and CC BY-SA 3.0)
- Music: "Bass Walker" by Kevin MacLeod, CC BY 3.0, see [client/music/CREDITS.md](client/music/CREDITS.md)
