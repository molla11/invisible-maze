# Invisible Maze Status

## 2026-06-02

- Created the service scaffold from an empty repository: Next.js app router, TypeScript, lint/test scripts, and environment template.
- Implemented local server-authoritative gameplay with the same API boundaries planned for Supabase deployment.
- Added Korean-first UI copy and responsive game screens for desktop/mobile.
- Added maze/rule unit tests, Supabase schema, README runbook, and ESLint/Vitest configuration.
- Verified `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Started the dev server at `http://localhost:3000` and smoke-tested room creation, second-session join, and game-state recovery.
- Updated movement to click-adjacent cells for one to three moves per turn, moved player B to bottom-right with top-left goal, switched the board to alternating light/dark cells, and limited wall display to the most recent collision.
- Restarted the dev server on `http://localhost:3001` because port 3000 was occupied, then smoke-tested room creation, join, and corrected start/goal coordinates.
- Changed click movement from queued submission to immediate per-cell moves. The server now tracks successful moves within the current turn, keeps the turn active after the first and second move, and passes the turn after the third move.
- Verified the immediate movement flow with API smoke tests: A moved from `(0,0)` to `(1,0)`, stayed on turn with `turnStepsUsed: 1`, then passed to B after the third successful move.
- Improved board markers: players now render as colored pin icons with A/B badges, and destinations render as colored flag icons with matching A/B badges.
- Replaced player pin markers with chess pawn-style markers while keeping the A/B badges for clarity.
- Upgraded `lucide-react` and replaced the pawn-style text marker with the real `ChessPawn` icon.
- Removed the pawn marker background and colored the `ChessPawn` icons directly: A is red and B is blue.
- Enlarged board icons, removed A/B badges, switched UI labels to Red/Blue teams, and changed destination flags to background-free colored icons.
- Simplified the game sidebar for immediate movement: removed the three move boxes and stale direction-pad CSS, leaving turn state, timer, remaining moves, status text, and the event log.
- Changed wall collisions to return the player to their original starting square, and hid a team's flag when that team's piece reaches the destination square.
- Adjusted revealed wall rendering so the marker is a black line centered on the boundary between cells rather than sitting inside one cell.
- Increased generated maze wall density from 28% to 42% and raised generation retries to preserve valid equal-distance boards.
- Cleaned up the lobby and game UI: removed the marketing-style background and rule cards, made matchmaking the dominant action, grouped secondary invite controls, simplified copy, and reduced the game sidebar to turn state, remaining moves, timer, status, and compact history.
- Reduced game-state network traffic by adding an SSE game events stream, switching the game client away from one-second polling, shrinking public game payloads, and adding ETag/304 support for the existing game-state endpoint.
- Updated heartbeat/version handling so connection keepalive updates do not force unchanged game states to be resent.
- Adjusted overlapping player rendering so Red and Blue pieces display side by side horizontally when both players occupy the same board cell.
- Verified the networking and overlap rendering changes with `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
