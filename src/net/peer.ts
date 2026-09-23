// Star topology over WebRTC DataChannel via PeerJS — SPEC §9.1. The host's
// peer-id *is* the room code (SPEC §9.2), so joining needs no lookup
// service. One reliable, ordered DataConnection per peer carries every
// message type (a simplification vs. the spec's separate reliable/unreliable
// channels — see net/protocol.ts).

import Peer, { type DataConnection, type PeerError } from "peerjs";
import { peerIdForRoom } from "./roomCode";
import type { ClientMessage, HostMessage } from "./protocol";
import { PeerWatchdog, type PeerConnState } from "./liveness";
import { PEER_DISCONNECT_GRACE, PEER_POLL_INTERVAL } from "../game/config";

/** Closing the tab has to take the peer down with it: PeerJS only sends its
 *  goodbye if something tells it to, and `unload` is too late on mobile,
 *  where a backgrounded tab can be discarded without it. `pagehide` is the
 *  one that fires in both cases. Returns the unsubscribe. */
function closeOnPageHide(teardown: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onHide = () => teardown();
  window.addEventListener("pagehide", onHide);
  window.addEventListener("beforeunload", onHide);
  return () => {
    window.removeEventListener("pagehide", onHide);
    window.removeEventListener("beforeunload", onHide);
  };
}

export type NetErrorInfo = { type?: string; message: string };

/** What RoomHost needs from the wire (SPEC §9.1). An interface rather than
 *  the class itself so a test can put a loopback in its place — PeerJS needs
 *  two real browsers, the room logic on top of it does not
 *  (tests/kick.test.ts). */
export interface HostTransport {
  send(connId: string, msg: HostMessage): void;
  broadcast(msg: HostMessage): void;
  kick(connId: string): void;
  readonly connectionIds: string[];
  destroy(): void;
}

export type HostNetworkCallbacks = {
  onHostReady?: () => void;
  onPeerJoin?: (connId: string) => void;
  onPeerLeave?: (connId: string) => void;
  onMessage?: (connId: string, msg: ClientMessage) => void;
  onError?: (err: NetErrorInfo) => void;
};

export class HostNetwork implements HostTransport {
  private peer: Peer;
  private conns = new Map<string, DataConnection>();
  /** `close` alone loses peers that vanish without saying so (SPEC §9.4) —
   *  see net/liveness.ts. */
  private watchdog = new PeerWatchdog(PEER_DISCONNECT_GRACE);
  private poll: ReturnType<typeof setInterval>;
  private unbindPageHide: () => void;

  constructor(roomCode: string, private cb: HostNetworkCallbacks) {
    this.peer = new Peer(peerIdForRoom(roomCode));
    this.peer.on("open", () => this.cb.onHostReady?.());
    this.peer.on("connection", (conn) => this.attach(conn));
    this.peer.on("error", (e) => this.cb.onError?.(toErrorInfo(e)));
    this.poll = setInterval(() => this.checkPeers(), PEER_POLL_INTERVAL * 1000);
    // A host closing the tab drops the room rather than leaving its guests
    // staring at a lobby nobody is running.
    this.unbindPageHide = closeOnPageHide(() => this.peer.destroy());
  }

  /** One sweep of every open connection's underlying WebRTC state. */
  private checkPeers() {
    const now = Date.now() / 1000;
    for (const [id, conn] of [...this.conns]) {
      const state = (conn.peerConnection?.connectionState as PeerConnState | undefined) ?? "unknown";
      if (this.watchdog.observe(id, state, now) === "keep") continue;
      // Same path as a clean close, so the slot goes back to a bot exactly as
      // it would have. `close()` is still worth calling: it releases the
      // connection on our side even when the other end is already gone.
      this.conns.delete(id);
      this.watchdog.forget(id);
      try {
        conn.close();
      } catch {
        // Already dead — the point of this sweep.
      }
      this.cb.onPeerLeave?.(id);
    }
  }

  private attach(conn: DataConnection) {
    conn.on("open", () => {
      this.conns.set(conn.peer, conn);
      this.cb.onPeerJoin?.(conn.peer);
    });
    conn.on("data", (data) => this.cb.onMessage?.(conn.peer, data as ClientMessage));
    conn.on("close", () => {
      if (!this.conns.delete(conn.peer)) return; // already swept
      this.watchdog.forget(conn.peer);
      this.cb.onPeerLeave?.(conn.peer);
    });
    conn.on("error", (e) => this.cb.onError?.(toErrorInfo(e)));
  }

  send(connId: string, msg: HostMessage) {
    this.conns.get(connId)?.send(msg);
  }

  broadcast(msg: HostMessage) {
    for (const conn of this.conns.values()) conn.send(msg);
  }

  kick(connId: string) {
    this.conns.get(connId)?.close();
    this.watchdog.forget(connId);
  }

  get connectionIds(): string[] {
    return [...this.conns.keys()];
  }

  destroy() {
    clearInterval(this.poll);
    this.unbindPageHide();
    this.peer.destroy();
  }
}

/** The client's half of the same seam. */
export interface ClientTransport {
  send(msg: ClientMessage): void;
  readonly connected: boolean;
  readonly myId: string | null;
  destroy(): void;
}

export type ClientNetworkCallbacks = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onMessage?: (msg: HostMessage) => void;
  onError?: (err: NetErrorInfo) => void;
};

export class ClientNetwork implements ClientTransport {
  private peer: Peer;
  private conn: DataConnection | null = null;
  private unbindPageHide: () => void;

  constructor(roomCode: string, private cb: ClientNetworkCallbacks) {
    // Closing the tab must reach the host, or it keeps this guest in the
    // roster (SPEC §9.4). The host's own watchdog is the backstop for the
    // cases this can't cover, like a crash or a dead network.
    this.unbindPageHide = closeOnPageHide(() => this.peer.destroy());
    this.peer = new Peer();
    this.peer.on("open", () => {
      const conn = this.peer.connect(peerIdForRoom(roomCode), { reliable: true });
      this.conn = conn;
      conn.on("open", () => this.cb.onConnected?.());
      conn.on("data", (data) => this.cb.onMessage?.(data as HostMessage));
      conn.on("close", () => this.cb.onDisconnected?.());
      conn.on("error", (e) => this.cb.onError?.(toErrorInfo(e)));
    });
    this.peer.on("error", (e) => this.cb.onError?.(toErrorInfo(e)));
  }

  send(msg: ClientMessage) {
    this.conn?.send(msg);
  }

  get connected(): boolean {
    return !!this.conn?.open;
  }

  /** This client's own PeerJS id, once assigned — used to recognize which
   *  slots in a roomState broadcast belong to us. */
  get myId(): string | null {
    return this.peer.id ?? null;
  }

  destroy() {
    this.unbindPageHide();
    this.peer.destroy();
  }
}

function toErrorInfo(e: PeerError<string> | Error): NetErrorInfo {
  const anyE = e as { type?: string; message?: string };
  return { type: anyE.type, message: anyE.message ?? String(e) };
}
