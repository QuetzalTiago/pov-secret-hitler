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
