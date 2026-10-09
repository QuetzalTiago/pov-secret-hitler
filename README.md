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
- **Bots that talk back**: point a finger at one and it answers. Bots reply when you name, accuse or
  insult them, argue their case with the evidence they actually hold, throw out reads of their own ("ese
  está raro"), call out whoever has gone quiet, warn you when they think you are being set up, hold grudges,
  and get annoyed when the table ignores them. Each one has a fixed personality, and they swear like real
  players. See [Table talk](#table-talk-bots-that-answer-you) below.
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

## Table talk: bots that answer you

Bots are chat participants, not a commentary track. Accuse one and it defends itself with the cards it
actually saw; insult one and it insults you back; ignore one that asked you a direct question and it gets
annoyed and says so. They also open accusations themselves when someone's record starts to smell, and they
remember who crossed them.

Two different models do two different jobs, and the split is deliberate:

| | Decides | Model |
|---|---|---|
| **What** a bot says: truth, lie, accusation, or silence | the strategy layer | Jev, falling back to the built-in heuristics |
| **How** it says it: the actual words, in character | the writing layer | any small text model (`SH_LLM_*`) |

Keeping the strategy out of the text model means a Fascist bot's lies are still chosen by the same tested
logic that plays its cards, and a bot can never talk itself into giving the game away. Every generated line
is sanitized before it reaches the table, and anything that reveals the speaker's own hidden role or breaks
character is dropped in favour of the scripted line.

What bots do with this, beyond answering you:

- **Read the table out loud.** Unprompted, in the quiet moments: a passing suspicion ("ese está raro, tiene
  pinta de facho"), a dig at whoever has not spoken in a while, or a full accusation with the round and the
  card when they actually have the evidence.
- **Call out a setup.** When a President they distrust is about to hand policies to someone the table still
  trusts, they say so — "ojo Nacho, te van a hacer la cama" — and louder when it is about to happen to them.
- **Take it personally.** Insult one and it insults you back and remembers; vote its government down and it
  notes every NEIN; ask it a direct question and ignore the answer and it will complain about being ignored.

They also talk the way the table talks rather than the way a translation engine does: *facho* for a fascist,
*facha* for the card, "me tocaron tres fachas", "quedar pegado", "se están cubriendo entre ellos".

To turn it on, set `SH_LLM_KEY` in `.env`. The default provider is Google Gemini on
[its free tier](https://aistudio.google.com/apikey); `SH_LLM_PROVIDER=openai` with `SH_LLM_URL` points the same
code at Groq, OpenRouter, or a local Ollama. See `.env.example` for ready-made settings.

**Without a key nothing is lost**: bots fall back to the built-in template lines and the game plays exactly
as it did before. The same is true if the provider errors, rate-limits or times out mid-game — a circuit
breaker stops calling out, the table quietly goes back to template lines, and it recovers on its own. The
text model is never on the path of a game action, so it cannot stall or break a match.

Bots speak **Rioplatense Spanish by default** (`SH_BOT_LANG=es-AR`, which also gives them Rioplatense names
and template lines); set `SH_BOT_LANG=en` for English. They swear the way players at a real table do — set
`SH_LLM_PROFANITY=0` if you would rather they did not.

To hear them without opening five browser windows (and to check your key works):

```bash
npm run talk
```

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
