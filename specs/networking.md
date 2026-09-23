# 9. Networking

Part of the [Tanks specification](../SPEC.md) — section numbers (§) are indexed there.

## 9.1 Topology

**Star, host-authoritative.** The host runs the only simulation that matters; clients predict
locally and reconcile.

Full mesh is wrong at this size — 10 peers means 45 connections. A star gives the host 9 connections
and every client exactly 1, which is also why the host must be the one with the best connection
(the room screen shows every ping, so the host can tell).

```
       client ─┐
       client ─┤
       client ─┼── HOST (authoritative sim + all bots) 
       client ─┤
       client ─┘
```

- Transport: **WebRTC DataChannel via PeerJS**, free public broker for signalling, Google STUN for
  NAT traversal. No server of our own, no public IP required.
- All bots run **on the host**, inside the authoritative simulation — bots cost nothing on clients
  and cannot desync.

## 9.2 Room code

6 characters from the 30-symbol alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0/O/1/I/L`), ≈ 7.3 ×
10⁸ combinations. The code **is** the host's PeerJS peer-id (namespaced as `tanks-<CODE>`), so no
lookup service is needed: joining is a direct `peer.connect('tanks-K7QM2X')`. On a code collision at
creation the host regenerates.

Invite links: `https://<pages-url>/?room=K7QM2X`.

## 9.3 Messages

| Message | Direction | Rate | Reliability |
|---|---|---|---|
| `hello` / `welcome` | both | once | reliable |
| `roomState` (slots, per-slot bot difficulty, map, settings, ready flags) | host → all | on change | reliable |
| `claimSlot` / `releaseSlot` / `setReady` | client → host | on action | reliable |
| `setBotDifficulty` (slot or all/team) | host-only, local → broadcast | on action | reliable |
| `matchStart` (map, seed, slot→tank mapping, difficulties, `t0`) | host → all | once | reliable |
| `mapTemplate` (id, name, template — rides `roomState`/`matchStart`) | host → all | with those, custom maps only | reliable |
| `input` `{seq, tick, seats:[{dir, fire, mine}]}` | client → host | 30 Hz | unreliable |
| `snapshot` (delta-encoded world state) | host → all | 15 Hz | unreliable |
| `events` (kill, pickup, flag hit, bonus, chat) | host → all | on event | reliable |
| `roundEnd` (round winner — always a team, rounds-won score, seconds to the next round) | host → all | per round, §2.2 | reliable |
| `roundStart` (round number, rounds-won score) | host → all | per round after the first | reliable |
| `matchEnd` (results, series score) | host → all | once | reliable |
| `ping` / `pong` | both | 1 Hz | unreliable |

**Snapshot contents:** tick, per-tank `{id, x, y, dir, state, upgrade, buffFlags}`, live bullets
`{id, x, y, dir}`, bonus entities, terrain changes since the client's last acknowledged tick, team
respawns and scores. Delta-encoded against the last acknowledged snapshot; a full snapshot is sent
every 2 s and on request. Budget: ~300 B per snapshot → **≈ 5 KB/s down** per client, ~1 KB/s up.
Payloads are packed binary (`ArrayBuffer`), not JSON.

> **As implemented:** every snapshot is a full snapshot, sent as JSON, at `NET_SNAPSHOT_HZ`. Terrain
> changes travel as their own reliable `terrain` events instead of a per-tick diff, so the client
> never needs to reconstruct a delta. This is simpler and easier to get right without two real
> devices to test against; it costs more bandwidth than the spec's binary deltas, which is the right
> trade for a room capped at 10 players. Switching to binary deltas later is a codec change, not an
> architecture change — see `net/protocol.ts`.

**Client-side:** prediction with input replay for your own seats, 100 ms interpolation delay for
everything else, and a snap-if-off-by-more-than-half-a-cell reconciliation rule. Bullets are never
predicted — the 100 ms of latency is honest and avoids phantom kills.

> **As implemented:** the client does not run a shadow simulation or replay inputs — it renders every
> tank, including its own, by interpolating between the last two snapshots (`render/arena.ts`). This
> is honest about latency in the same spirit as the bullet rule above, just applied to every tank,
> and it avoids a whole class of prediction/reconciliation bugs that can only really be shaken out by
> playtesting over a real, lossy connection. Revisit once there's real latency data to tune against.
> The interpolation window isn't the fixed `NET_SNAPSHOT_HZ` delay either — it's the *observed* gap
> between the last two snapshots. That matters because the host's own view gets a snapshot every sim
> tick (30 Hz, `host.ts`), not the network-throttled rate the fixed constant assumed; using the fixed
> value there meant the interpolated position perpetually lagged the true one, invisible while
> driving straight but a visible kink right at a direction change.

## 9.4 Failure handling

- **Client drops:** its slots revert to bots immediately; the tanks keep fighting. A 60-second grace
  window lets the same nickname reclaim its slots on reconnect, mid-match.
- **How a drop is noticed.** A DataConnection's `close` event is *not* enough: a tab closed
  abruptly, a crashed browser or a dead network often produce no `close` at all, and the guest stays
  in the roster forever. Two mechanisms, and the room needs both:
  1. **The leaver says so.** Both sides tear their `Peer` down on `pagehide` (and `beforeunload`),
     which is what makes a closed tab leave the roster within a second. `pagehide` rather than
     `unload` alone because a backgrounded mobile tab can be discarded without ever firing `unload`.
     A host closing its tab drops the room the same way, instead of leaving guests in a lobby
     nobody is running.
  2. **The host watches anyway**, once a second, over each connection's own
     `RTCPeerConnection.connectionState` (`net/liveness.ts`, `PeerWatchdog`) — the signal the
     browser maintains from ICE, which no page-lifecycle event can be relied on to replace.
     `failed`/`closed` drops the peer at once; `disconnected` is given
     `PEER_DISCONNECT_GRACE` (8 s) first, because ICE blips in and out on a roaming phone and a
     momentary disconnect must not end someone's match. Either way it goes down the same path a
     clean close does, so the slot reverts to a bot exactly as it would have.

  Measured in two real Chromium contexts: closing the tab removes the guest in **under 6 s** (path
  1); killing the context outright, so nothing fires, has Chromium report `disconnected` after
  ~10 s and the watchdog drop the guest **~8 s later** (path 2).
- **Host drops:** the match cannot continue — clients see the disconnect overlay and are returned to
  the main menu with the room code preserved so someone can recreate it. *Host migration is
  explicitly out of scope* (§13): it means transferring the authoritative sim mid-match, and the
  complexity is not worth it for a 10-minute casual match.
- **Broker unreachable:** create/join fails with a clear message and a retry, plus a note in the
  README about self-hosting a broker.
- **Cheating:** the host is authoritative and validates every input (rate, direction, fire cooldown),
  which stops the casual case. A malicious *host* can cheat freely; that is accepted — matches are
  ad-hoc games among people who shared a code.
