// Loopback plumbing for the netcode tests — see tests/kick.test.ts for why
// this exists: `RoomHost`/`RoomClient` take an optional transport factory
// (`HostTransport`/`ClientTransport` in src/net/peer.ts), so the two real room
// objects can be driven against each other with no PeerJS and no browser.

import { RoomHost } from "../src/net/host";
import { RoomClient } from "../src/net/client";
import type { ClientMessage, HostMessage } from "../src/net/protocol";
import type {
  ClientNetworkCallbacks,
  ClientTransport,
  HostNetworkCallbacks,
  HostTransport,
  NetErrorInfo,
} from "../src/net/peer";
import type { RoomCallbacks } from "../src/net/room";

// The client's input loop is driven by requestAnimationFrame, which node
// doesn't have. Stubbed to never fire: these tests are about membership, and a
// running input loop would only add noise.
const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
g.requestAnimationFrame ??= () => 0;
g.cancelAnimationFrame ??= () => {};

const CONN = "guest-conn";

export type Exit = { reason: string; kicked: boolean };

/** A host and a guest wired straight to each other, plus what each side saw. */
export function loopbackRoom(opts: { hostCallbacks?: RoomCallbacks; roomCode?: string } = {}) {
  let hostCb: HostNetworkCallbacks | null = null;
  let clientCb: ClientNetworkCallbacks | null = null;
  const toClient: HostMessage[] = [];
  const toHost: ClientMessage[] = [];
  const exits: Exit[] = [];
  const errors: string[] = [];
  const hostExits: Exit[] = [];
  const hostErrors: string[] = [];
  let closed = false;

  const hostTransport: HostTransport = {
    send(connId, msg) {
      if (connId !== CONN || closed) return;
      toClient.push(msg);
      clientCb?.onMessage?.(msg);
    },
    broadcast(msg) {
      if (closed) return;
      toClient.push(msg);
      clientCb?.onMessage?.(msg);
    },
    kick() {
      if (closed) return;
      closed = true;
      // What PeerJS does to the other end: the socket simply goes.
      clientCb?.onDisconnected?.();
    },
    get connectionIds() {
      return closed ? [] : [CONN];
    },
    destroy() {},
  };

  const clientTransport: ClientTransport = {
    send(msg) {
      if (closed) return;
      toHost.push(msg);
      hostCb?.onMessage?.(CONN, msg);
    },
    get connected() {
      return !closed;
    },
    myId: CONN,
    destroy() {
      closed = true;
    },
  };

  const host = new RoomHost({
    nickname: "Host",
    online: false,
    // A room that never opened reaches the host through the same `onLeft` a
    // kicked guest gets (SPEC §9.4), so record both sides' exits.
    callbacks: {
      onLeft: (e) => hostExits.push(e),
      onError: (msg) => hostErrors.push(msg),
      ...opts.hostCallbacks,
    },
    roomCode: opts.roomCode,
    makeNet: (cb) => {
      hostCb = cb;
      return hostTransport;
    },
  });
  const client = new RoomClient("ABC234", "Olga", {
    onLeft: (e) => exits.push(e),
    onError: (msg) => errors.push(msg),
  }, (cb) => {
    clientCb = cb;
    return clientTransport;
  });

  // The guest's side of "the connection opened": it says hello, and the host
  // seats it on the first free bot slot (host.ts autoSeat).
  clientCb!.onConnected?.();

  const guestSlot = () => host.slots.find((s) => s.owner === CONN) ?? null;

  return {
    host,
    client,
    exits,
    errors,
    hostExits,
    hostErrors,
    toClient,
    toHost,
    guestSlot,
    isClosed: () => closed,
    dropHost: () => clientCb!.onDisconnected?.(),
    /** What the broker says when the requested peer-id is already in use. */
    brokerRejectsCode: () =>
      hostCb!.onError?.({ type: "unavailable-id", message: "ID is taken" } satisfies NetErrorInfo),
  };
}


export const wait = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000));
