// Star topology over WebRTC DataChannel via PeerJS — SPEC §9.1. The host's
// peer-id *is* the room code (SPEC §9.2), so joining needs no lookup
// service. One reliable, ordered DataConnection per peer carries every
// message type (a simplification vs. the spec's separate reliable/unreliable
// channels — see net/protocol.ts).

import Peer, { type DataConnection, type PeerError } from "peerjs";
import { peerIdForRoom } from "./roomCode";
import type { ClientMessage, HostMessage } from "./protocol";

export type NetErrorInfo = { type?: string; message: string };

export type HostNetworkCallbacks = {
  onHostReady?: () => void;
  onPeerJoin?: (connId: string) => void;
  onPeerLeave?: (connId: string) => void;
  onMessage?: (connId: string, msg: ClientMessage) => void;
  onError?: (err: NetErrorInfo) => void;
};

export class HostNetwork {
  private peer: Peer;
  private conns = new Map<string, DataConnection>();

  constructor(roomCode: string, private cb: HostNetworkCallbacks) {
    this.peer = new Peer(peerIdForRoom(roomCode));
    this.peer.on("open", () => this.cb.onHostReady?.());
    this.peer.on("connection", (conn) => this.attach(conn));
    this.peer.on("error", (e) => this.cb.onError?.(toErrorInfo(e)));
  }

  private attach(conn: DataConnection) {
    conn.on("open", () => {
      this.conns.set(conn.peer, conn);
      this.cb.onPeerJoin?.(conn.peer);
    });
    conn.on("data", (data) => this.cb.onMessage?.(conn.peer, data as ClientMessage));
    conn.on("close", () => {
      this.conns.delete(conn.peer);
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
  }

  get connectionIds(): string[] {
    return [...this.conns.keys()];
  }

  destroy() {
    this.peer.destroy();
  }
}

export type ClientNetworkCallbacks = {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onMessage?: (msg: HostMessage) => void;
  onError?: (err: NetErrorInfo) => void;
};

export class ClientNetwork {
  private peer: Peer;
  private conn: DataConnection | null = null;

  constructor(roomCode: string, private cb: ClientNetworkCallbacks) {
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
    this.peer.destroy();
  }
}

function toErrorInfo(e: PeerError<string> | Error): NetErrorInfo {
  const anyE = e as { type?: string; message?: string };
  return { type: anyE.type, message: anyE.message ?? String(e) };
}
