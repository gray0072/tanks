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

The code **is** the host's PeerJS peer-id (namespaced as `tanks-<CODE>`), so no lookup service is
needed: joining is a direct `peer.connect('tanks-K7QM2X')`.

**Any 3–12 characters of `A-Z0-9` is a code.** What the game *generates* is narrower: 6 characters
from the 27-symbol alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` minus the look-alikes (`0/O`,
`1/I/L`), ≈ 7.3 × 10⁸ combinations — because a generated code exists to be read out over a call,
where `0` and `O` are the same sound. A code the **host types** is accepted with the whole
alphabet: its point is to read like a word (`SERGEY`, `DVOR`), and refusing someone's own name over
an `I` would be pedantry. Typed input is upper-cased and stripped of punctuation, so `sergey` and
`k7qm-2x` both arrive as the code they obviously mean.

**A chosen code is remembered** (`UserSettings.roomCode`) and pre-filled next time, which is the
whole point of having one: the invite link stays the same across a reload, an evening or a month,
so friends can keep the link rather than being read six fresh characters. Reloading the page frees
the id immediately — both peers destroy themselves on `pagehide` (§9.4) — so the same host can
re-open the same code straight away. Re-creating the room is still a deliberate act: the game does
not open a room on load by itself, because a reloaded host cannot resume the match it was in and
guests do not auto-reconnect.

**On a collision, what happens depends on who picked the code.** A *generated* code that the broker
reports as `unavailable-id` is simply regenerated and nobody is told. A *chosen* one is reported to
the host instead (`onLeft`, §9.4) — quietly hosting under a different code would break the one
thing a chosen code is for.

Invite links: `https://<pages-url>/?room=SERGEY`. A link's code is validated, never truncated: a
link carrying more than 12 characters is a link to nowhere rather than to the first twelve.

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
- **Host drops:** the match cannot continue — clients are returned to the main menu, told why.
  *Host migration is explicitly out of scope* (§13): it means transferring the authoritative sim
  mid-match, and the complexity is not worth it for a casual match.
- **Kicked:** the host **sends `kicked` and closes the connection a moment later**
  (`KICK_CLOSE_DELAY`, 0.25 s) rather than closing it outright — a dropped socket on its own tells
  the guest nothing, and a guest that doesn't know it was removed goes on looking at a lobby it is
  no longer part of.
- **Either way, the client is out of the room, and one code path says so.** `RoomClient` turns both
  a `kicked` message and a lost connection into a single `onLeft({ reason, kicked })`: it stops
  sending input, forgets the match (so no screen that mounts afterwards can be replayed back into
  it) and hands the reason up. Every screen that holds a room — lobby, match, result — destroys it
  and returns to the menu, which shows the reason. The exit is idempotent, so the close that
  follows a kick doesn't overwrite "you were removed" with "the host left".

> **As implemented.** The room code is *not* carried back to the menu. A new room gets a new code
> (§9.2 derives the host's peer-id from it, and the old one may still be held by the departing
> host's broker session), so keeping it would only offer a code that no longer resolves.
>
> `RoomHost` and `RoomClient` both take an optional transport factory —
> `HostTransport`/`ClientTransport` in `peer.ts`. Production passes nothing and gets PeerJS; a test
> passes a loopback and drives the two real room objects against each other, which is what
> `tests/kick.test.ts` does. That seam exists because the membership rules are worth testing and
> PeerJS itself needs two browsers.
- **Broker unreachable:** create/join fails with a clear message and a retry, plus a note in the
  README about self-hosting a broker.
- **Cheating:** the host is authoritative and validates every input (rate, direction, fire cooldown),
  which stops the casual case. A malicious *host* can cheat freely; that is accepted — matches are
  ad-hoc games among people who shared a code.
