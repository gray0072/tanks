// Deciding when a peer is gone — SPEC §9.4.
//
// A DataConnection's `close` event is not dependable: a tab closed abruptly,
// a killed browser or a dropped network often produce no `close` at all, and
// the host went on showing the guest in the roster forever. What *is*
// dependable is the underlying `RTCPeerConnection`'s own state, which the
// browser maintains from ICE — so the host polls that and feeds it here.
//
// The rule lives apart from `peer.ts` because it is the part worth testing:
// no DOM, no PeerJS, just "given what this connection's state has been doing,
// is the peer still there?" (tests/joinAndLeave.test.ts).

/** The subset of `RTCPeerConnectionState` we act on, plus "unknown" for a
 *  connection that hasn't reported one yet. */
export type PeerConnState = "unknown" | "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

export type PeerVerdict = "keep" | "drop";

/** States that mean the connection is finished and will not recover. */
const DEAD: PeerConnState[] = ["failed", "closed"];

export class PeerWatchdog {
  /** When each peer first went "disconnected", for the ones currently in it. */
  private disconnectedSince = new Map<string, number>();

  /** @param graceSeconds how long a peer may stay "disconnected" before it is
   *  dropped. ICE blips in and out on a roaming phone, so a momentary
   *  disconnect must not end someone's match; a closed tab reaches "failed"
   *  or "closed" instead and is dropped without waiting. */
  constructor(private graceSeconds: number) {}

  /** Verdict for one poll of one peer. `now` is in seconds, from any clock
   *  that only moves forward. The caller is expected to stop polling a peer
   *  it has dropped (the host removes the connection), so a verdict is not
   *  latched here — asking again about a still-dead peer says "drop" again. */
  observe(connId: string, state: PeerConnState, now: number): PeerVerdict {
    if (DEAD.includes(state)) {
      this.disconnectedSince.delete(connId);
      return "drop";
    }
    if (state !== "disconnected") {
      // Back on its feet (or never left): the grace timer starts fresh next
      // time, rather than counting a blip from an hour ago.
      this.disconnectedSince.delete(connId);
      return "keep";
    }
    const since = this.disconnectedSince.get(connId);
    if (since === undefined) {
      this.disconnectedSince.set(connId, now);
      return "keep";
    }
    return now - since >= this.graceSeconds ? "drop" : "keep";
  }

  /** Called when a peer leaves by any other route, so its timer doesn't
   *  outlive it. */
  forget(connId: string) {
    this.disconnectedSince.delete(connId);
  }

  /** How long this peer has been "disconnected", or null if it isn't. For
   *  tests and diagnostics. */
  disconnectedFor(connId: string, now: number): number | null {
    const since = this.disconnectedSince.get(connId);
    return since === undefined ? null : now - since;
  }
}
