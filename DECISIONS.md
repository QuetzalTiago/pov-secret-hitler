# Decisions

Decisions made autonomously while building, with the reasoning.

1. **Name:** the project is branded *POV Secret Hitler* (povsecrethitler.app). It is labelled everywhere as an unofficial, non-commercial fan adaptation, and the original game and designers are credited.
2. **Single package, no workspaces.** `shared/` is imported by server (via `tsx`), client (via Vite) and tests (via Vitest). Less tooling, one `npm install`.
3. **Server runs through `tsx`** rather than a separate `tsc` build step. TypeScript 7 is installed for type checking (`npm run typecheck`).
4. **Seat index is the player identity inside the engine.** Clockwise = increasing seat index; "to your left" = next seat. Seats are fixed once the game starts.
5. **Engine is a pure reducer** `reduce(state, action) -> { state, events }`. RNG (mulberry32) state lives inside `GameState`, so the same seed + actions always yields the same game. The engine clones its input; callers never see mutation.
6. **Events are public-only by construction.** Anything secret (hands, peeks, investigation results, roles) is only ever exposed through `viewFor(state, seat)`. This makes the no-leak guarantee easy to test: events contain no card values except publicly enacted policies.
7. **Reshuffle check** runs both after every enactment and before every draw ("whenever fewer than 3 cards remain").
8. **Night phase** waits for every player to "close their eyes" (acknowledge their role), with a timer fallback, so the role envelope reveal is diegetic and nobody is rushed.
9. **Veto:** a refused veto forces the chancellor to enact; the chancellor cannot propose veto twice in the same session.
10. **Timers:** when a phase timer expires, the server makes a random legal move for each player still owing an action (same code path as bots). Default timers are generous (nominate 90s, vote 60s, legislation 75s, powers 90s, night 20s).
11. **Disconnected players** are replaced by a bot after 60s; an explicit "leave" during a game hands control to a bot immediately. Their reconnect token stays valid so they can come back.
12. **Mouse look** is cursor-driven (camera yaw/pitch follows the cursor within clamps) instead of pointer lock, so clicking objects with a visible cursor works and Playwright can drive it.
13. **Tunnel target** is `http://127.0.0.1:PORT` instead of `localhost` so cloudflared never tries `::1` while the server is bound to IPv4 loopback only.
14. **Per-IP limits** use the `CF-Connecting-IP` header, which is trustworthy because the server only listens on loopback and the only public path in is the Cloudflare tunnel.
15. **No external assets, with one exception:** geometry, textures (canvas) and fonts (system stacks) are generated at runtime. At the owner's request, the gunshot, death groans and the JA!/NEIN! shouts are real recordings from openly licensed sources (CC0 and CC BY-SA 3.0), and the background music is Kevin MacLeod's "Bass Walker" on loop (CC BY 3.0). All are credited in-game, in client/sfx/CREDITS.md and client/music/CREDITS.md; everything else is synthesized with WebAudio.
16. **Bot speech is split in two layers.** Jev (or the built-in heuristics) chooses the *intent* — tell the
    truth, lie, accuse, stay quiet — exactly as before; a separate small text model only *writes* that intent
    in the bot's voice. Letting one model do both would put a free-text generator in charge of strategy, where
    a single slip ("ok, soy fascista") ends the game. The writing layer gets only the seat's own `GameView`
    and `Memory`, and every line it produces is sanitized before it reaches the table: lines that reveal the
    speaker's hidden role or break character are dropped and the scripted template line is typed instead.
17. **The text model is provider-neutral and optional.** One small adapter per provider (Gemini, OpenAI-shaped,
    Anthropic) over raw `fetch`, matching `jev.ts`, instead of an SDK: the project has three runtime
    dependencies and this feature adds none. `SH_LLM_PROVIDER=openai` plus `SH_LLM_URL` covers Groq,
    OpenRouter and a local Ollama, so a table can run on a free tier. Degradation is total and silent: no key,
    an outage, a rate limit or a timeout all fall back to the template lines the game already shipped with, via
    a circuit breaker so a dead provider costs no latency. Nothing in the chat path can block a game action.
18. **Bots speak Rioplatense Spanish by default** (`SH_BOT_LANG=es-AR`), with matching names, because that is
    the table this was built for; `SH_BOT_LANG=en` restores the original English bots. Profanity is on by
    default (`SH_LLM_PROFANITY=0` to disable) — bots that cannot swear do not read as players, and for Gemini
    that also means turning the harassment and hate-speech filters off, or a bot goes mute mid-argument.
19. **Personalities are derived from the bot's name**, not stored: the same name always yields the same
    character, so a bot survives a server restart as itself without adding anything to the room snapshot.
