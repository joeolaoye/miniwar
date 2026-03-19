# Mini War — Tactical Grid Game Plan (v0.2)

Mini War is a browser-first, turn-based tactics game designed to deliver meaningful strategy in short 3–5 minute matches.

This document is the implementation-oriented blueprint for:

- Gameplay rules and balancing baseline.
- Front-end UI/UX and interaction model.
- Multiplayer backend architecture and data model.
- Delivery phases from prototype to production.


## Quick start (local prototype)

This repository now includes a playable browser MVP:

- `index.html` — app shell and HUD
- `style.css` — board and UI styling
- `game.js` — deterministic local rules engine + interaction logic

Run locally:

```bash
python3 -m http.server 4173
```

In a second terminal, run the local WebSocket server:

```bash
npm run server
```

Then open `http://127.0.0.1:4173`. Run tests with:

```bash
npm test
```

## UI polish pass (implemented)

Completed improvements in the playable MVP:

- Icon-based unit rendering (Commander, Soldier, Scout, Tank, Artillery).
- HP badge overlays on each unit tile.
- Animated visual effects for move, attack, hit, and kill events.
- Improved panel UX with icon legend and recent action feed.
- Enhanced board readability via stronger HUD containers and tile states.
- Turn timer with auto end-turn on timeout.
- Toggleable threat map overlay to read enemy attack coverage.
- Rolling action history panel for tactical playback.
- Keyboard shortcut: press `E` to end turn quickly.
- Multiple selectable maps (Center Pressure, Broken Ridge, Split Pass).
- Hill terrain that blocks ranged line-of-sight.
- Unit-specific climbing rules (Commander/Scout can climb; others cannot).
- Ranged LOS is lane-based (orthogonal/diagonal only) and hills block lanes.
- Movement now uses step-by-step pathing (no teleporting through blocked tiles).
- Threat map highlights full enemy coverage, not just currently occupied attack targets.
- Hover/focus previews now explain move paths, attack damage, and invalid-action reasons.
- Rules engine extracted into reusable modules for testing and server validation.
- Local dependency-free WebSocket server added for authoritative two-client matches.
- Shared protocol module added for versioned client/server message types.
- HUD now shows connection mode/assigned side and exposes rematch/connect controls.
- Browser client now supports explicit queue join/leave, room IDs, and reconnect resume via stored session IDs.

## 1) Product goals

### Experience goals

- **Fast tactical depth:** every turn should offer at least 2–3 viable options.
- **Short session length:** most matches end in 3–5 minutes.
- **High readability:** users should parse board state quickly on desktop and mobile.
- **Competitive fairness:** deterministic rules, clear tiebreakers, minimal hidden randomness.

### Business/retention goals

- High rematch intent after first game.
- Strong return play for ranked ladder sessions.
- Spectator/replay hooks for shareability later.

## 2) Core gameplay specification

### Match format

- **Mode:** 1v1 real-time turn-based online match.
- **Board:** 6x6.
- **Roster:** 6 units per player.
- **Turn economy:** 2 AP per turn.
- **Turn timer:** 25s (ranked), 40s (casual).
- **Round cap:** 20 rounds.

### Win conditions

A player wins by:

1. Defeating enemy Commander, or
2. Holding objective tile until start of their next turn.

At round cap, tiebreak order:

1. Commander alive.
2. Unit count alive.
3. Objective control.
4. Total HP.
5. If still tied: draw.

### Unit roster (v0.2 baseline)

| Unit | HP | Move | Range | Damage | Special Rule |
|---|---:|---:|---:|---:|---|
| Commander | 3 | 1 | 1 | 1 | Defeat = lose match |
| Soldier | 2 | 1 | 1 | 1 | No special rule |
| Scout | 2 | 2 | 1 | 1 | Cannot attack if moved 2 tiles this turn |
| Tank | 4 | 1 | 1 | 1 | Takes -1 ranged damage (min 1) |
| Artillery | 2 | 1 | 2–3 | 2 | Cannot attack adjacent targets |

Per-player composition:

- 1x Commander
- 2x Soldier
- 1x Scout
- 1x Tank
- 1x Artillery

### Map and terrain

Starter map: **Center Pressure**

- 6x6 board
- 1 center objective tile
- 2 cover tiles per side

Terrain effects (v0.2):

- **Cover:** -1 ranged damage taken (minimum 1)
- **Danger ring (round 8+):** units ending turn on outer ring take 1 damage

### Rules clarifications (for implementation)

- AP is shared team-wide and may be spent by any units.
- Units block movement through occupied tiles.
- Attacks require line-of-fire only for ranged units (orthogonal + diagonal allowed for artillery).
- No reaction/overwatch system in MVP.
- Simultaneous effects resolve in this order at end turn:
  1. Objective hold check
  2. Danger ring damage
  3. Unit death cleanup

## 3) UI/UX design plan

## 3.1 Screen map

1. **Home/Lobby**
   - Play (Ranked / Casual)
   - Loadout preview (fixed in v0.2)
   - Profile + settings
2. **Matchmaking**
   - Queue timer
   - Cancel
   - Region + ping display
3. **Game Board**
   - Board canvas/grid
   - Unit details panel
   - AP + timer HUD
   - Turn log feed
   - End Turn button
4. **Post-match**
   - Winner and reason (Commander KO / Objective / Tiebreak)
   - Rematch CTA
   - Return lobby CTA

## 3.2 Board interactions

- Tap/click unit to select.
- Show legal move tiles (blue) and attack tiles (red).
- Tap destination/target to queue action.
- User can undo queued actions before commit if AP remains.
- Commit occurs immediately after each action in online mode (server authoritative).

### Interaction states

- `idle`
- `unit_selected`
- `targeting_move`
- `targeting_attack`
- `awaiting_server_ack`
- `enemy_turn`
- `match_end`

### Essential feedback

- AP counter updates every action.
- Turn timer with warning pulse at <=5s.
- Clear enemy turn lock (prevent accidental input).
- Damage/heal floating numbers and death animation <=400ms.

## 3.3 Information hierarchy

Top priority data always visible:

- Current turn owner
- Remaining AP
- Remaining turn time
- Commander HPs (both players)
- Objective status (neutral / controlled / hold-progress)

Secondary data (panel/tooltip):

- Unit stats
- Ability/rule reminders
- Round number + danger ring active state

## 3.4 Accessibility

- Colorblind-safe palette for move/attack/threat overlays.
- Keyboard support (desktop): arrows to cycle units, Enter to confirm.
- Reduced-motion toggle.
- Text alternatives for animation-only signals.

## 4) Multiplayer architecture plan

## 4.1 High-level architecture

- **Client:** browser SPA (React or similar) rendering board + HUD.
- **Game service:** WebSocket server managing live matches.
- **Matchmaking service:** queue + match assignment.
- **Persistence:** relational DB for users, match records, ratings.
- **Cache/pubsub:** Redis for queue state and horizontal scaling coordination.

### Recommended stack

- Frontend: TypeScript + React + state machine (XState or equivalent)
- Backend: Node.js (Fastify/Nest) or Go (Gin/Fiber)
- Real-time: WebSockets (Socket.IO or raw ws with protocol)
- DB: Postgres
- Infra: containerized services + managed Redis/Postgres

## 4.2 Authoritative game model

Server is source of truth.

- Client sends `ActionRequest` (move, attack, end_turn).
- Server validates against canonical state.
- If valid, server applies action and broadcasts `StateDelta`.
- If invalid, server returns `ActionRejected` with reason.

Benefits:

- Cheat resistance
- Deterministic replays
- Reconnect consistency

## 4.3 Real-time protocol (minimal)

Inbound client events:

- `queue_join`
- `queue_leave`
- `match_ready_ack`
- `action_request`
- `emote`
- `reconnect_resume`

Outbound server events:

- `queue_status`
- `match_found`
- `match_state_snapshot`
- `state_delta`
- `turn_timeout`
- `match_result`
- `error`

### Action request payload shape (example)

```json
{
  "matchId": "m_123",
  "turn": 7,
  "actionId": "a_987",
  "type": "attack",
  "unitId": "u_p1_artillery",
  "target": { "x": 3, "y": 2 }
}
```

### Idempotency rule

- `actionId` must be unique per client and stored server-side for short TTL.
- Duplicate `actionId` returns existing outcome to handle retries.

## 4.4 Reconnect and fault tolerance

Reconnect strategy:

1. Client reconnects and sends `reconnect_resume` with last seen sequence.
2. Server responds with missing deltas or full snapshot.
3. Timer continues on server while disconnected.

Timeout policy:

- If disconnected player fails to return before timer expires, turn auto-ends.
- Consecutive missed turns threshold can forfeit match (e.g., 2).

## 4.5 Matchmaking and rating

Queue keys:

- mode (ranked/casual)
- region
- rating bucket (ranked)

Matching algorithm:

- Start with narrow rating window; expand every N seconds.
- Prioritize low ping region.

Rating system:

- Elo/Glicko baseline in ranked only.
- Casual has hidden MMR for quality matching.

## 4.6 Data model (MVP)

Core tables:

- `users`
- `player_ratings`
- `matches`
- `match_players`
- `match_events` (append-only action log)
- `sessions`

Event sourcing note:

- `match_events` allows replay reconstruction and audit.
- Periodic snapshots reduce replay rebuild costs.

## 4.7 Anti-cheat and integrity

- Server-side rule validation only.
- Signed auth tokens for socket session.
- Rate limit action requests per second.
- Detect impossible action cadence (spam/automation heuristics).

## 5) Engineering delivery plan

## Phase A — Local prototype (single process)

- Implement board rules engine as pure deterministic module.
- Build local hot-seat mode using same engine API.
- Add property tests for move legality and win resolution.

Exit criteria:

- Complete match playable locally.
- No rule desync in 1,000 simulated matches.

## Phase B — Online MVP

- Add WebSocket authoritative server.
- Add matchmaking queue and reconnect flow.
- Persist match outcomes + ratings.

Exit criteria:

- 95th percentile action RTT < 250ms in target region.
- Reconnect success rate > 98% within 15s.

## Phase C — Competitive polish

- Replay viewer from event log.
- Observer mode.
- Telemetry dashboards and balance iteration loop.

Exit criteria:

- Median match length 3–5 minutes.
- First-player win rate between 48% and 52%.

## 6) Telemetry and analytics

Track per match:

- duration_seconds
- turns_total
- timeout_count per player
- win_reason
- first_player_won
- damage_dealt per unit type
- objective_turns_controlled

Track product funnels:

- queue start -> match start conversion
- match end -> rematch click-through
- day-1 and day-7 retention cohorts

## 7) Risks and mitigations

- **Risk:** turn desync between clients
  - **Mitigation:** sequence-numbered server deltas + snapshot fallback
- **Risk:** matches exceed 5 minutes
  - **Mitigation:** danger ring + strict timer + capped rounds
- **Risk:** first-player advantage
  - **Mitigation:** telemetry gate + map and stat tuning
- **Risk:** mobile UI clutter
  - **Mitigation:** strict information hierarchy + progressive detail panels

## 8) Immediate next tasks

1. Build `rules-engine` package with exhaustive unit tests.
2. Define WebSocket event schema in a versioned protocol file.
3. Create low-fidelity UI wireframes for the 4 core screens.
4. Implement local playable prototype before full networking.
5. Run 200 bot-vs-bot simulations for initial balance signal.
