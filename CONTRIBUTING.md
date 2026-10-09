# Contributing to POV Secret Hitler

Thanks for helping! Bug reports, ideas, fixes, art and sound improvements are all welcome.

## Ways to help

- **Report a bug** or **suggest a feature** using the issue templates.
- **Pick up an issue**: look for `good first issue` or `help wanted`, and comment that you're on it so work
  isn't duplicated.
- **Open a pull request** for anything small. For bigger changes (new mechanics, rule variants, big UI
  reworks), please open an issue first so we can agree on the approach.

## Setup

Requires Node.js 22.5+.

```bash
git clone https://github.com/<you>/pov-secret-hitler.git
cd pov-secret-hitler
npm ci
npm run dev          # server (port 3000), restarts on change
npm run dev:client   # client with hot reload (open the URL it prints)
```

Add `?nolock` to the URL to keep the mouse free while developing. You don't need an API key: without one the
bots use their built-in strategy.

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run typecheck
npm test
npm run simulate
npm run build
```

If you touched gameplay or the 3D client, also play a game locally, and consider `npm run e2e`.

In the PR description, say **what changed for players** and how you tested it. Keep PRs focused: one change
per PR is much easier to review.

## Ground rules for the code

These keep the game fair and safe to host on the internet:

1. **The server is the authority.** Clients only render and send intentions; every action is validated
   against the current state on the server.
2. **No hidden-information leaks.** A client may only ever receive what its own player is allowed to know.
   All game data reaches clients through `viewFor()` in `shared/view.ts`; events must stay public-only.
   If you add state, extend the leak tests in `tests/view-leak.test.ts`.
3. **The rules engine stays pure.** `shared/engine.ts` is a deterministic `state + action -> state` function
   with no I/O, randomness only through the stored RNG state, and tests for every rule.
4. **Validate all input.** New client messages need a strict validator in `shared/protocol.ts` and a test.
5. **Bots play fair.** Bot logic may only use the bot's own `GameView` and its memory, never the full state.
   This covers what they *say* as well as what they do: prompts for bot chat are built from that same seat's
   view, and generated lines are sanitized so a bot cannot reveal its own hidden role. Anything that reaches
   a text model goes through `server/bottalk.ts`; keep it that way and extend the tests in
   `tests/bot-reactions.test.ts`. Bot chat must always degrade to the built-in template lines when no API key
   is set or the provider fails — a game must never depend on it.
6. **Assets must be openly licensed and credited.** Prefer procedural geometry, canvas textures and
   synthesized sound. Any added file must be CC0, public domain, or a license compatible with this project's,
   with author, source and license recorded in the matching `CREDITS.md` and the in-game credits.
7. **Never commit secrets** (`.env`, `tunnel.json`, `data/`, `logs/` are git-ignored for a reason).

Match the style of the surrounding code; TypeScript strict mode is on.

## License of contributions

This project is licensed under [CC BY-NC-SA 4.0](LICENSE), because Secret Hitler itself is. By submitting a
contribution you agree that it is licensed under the same terms, and that you have the right to submit it.
