// Being removed from a room — SPEC §9.4.
//
// The bug: the host closed the kicked player's socket and never told them
// what happened, and nothing on the client acted on the `kicked` message
// either — so a kicked player went on looking at a lobby they were no longer
// part of, indefinitely.
//
// This drives the *real* RoomHost and RoomClient against each other over a
// loopback transport (tests/netHelpers.ts), so the whole chain is under test —
// kick -> message -> client exit -> roster back to a bot — without needing two
// browsers for PeerJS.

import test from "node:test";
import assert from "node:assert/strict";

import { loopbackRoom as room, wait } from "./netHelpers";
import { KICK_CLOSE_DELAY } from "../src/game/config";

test("a guest that says hello is seated, and the host knows whose slot it is", () => {
  const r = room();
  const slot = r.guestSlot();
  assert.ok(slot, "the guest should hold a slot");
  assert.equal(slot!.kind, "human");
  assert.equal(slot!.nickname, "Olga");
  assert.deepEqual(r.exits, [], "nobody has left anything yet");
  r.client.destroy();
  r.host.destroy();
});

test("a kicked guest is told it was removed, and why", () => {
  const r = room();
  const slot = r.guestSlot()!;

  r.host.kickSlot(slot.id);

  assert.ok(
    r.toClient.some((m) => m.t === "kicked"),
    "the host must send `kicked` — closing the socket alone tells the guest nothing",
  );
  assert.equal(r.exits.length, 1);
  assert.equal(r.exits[0].kicked, true);
  assert.match(r.exits[0].reason, /removed/i);
  r.client.destroy();
  r.host.destroy();
});

test("the kicked slot goes back to a bot", () => {
  const r = room();
  const id = r.guestSlot()!.id;

  r.host.kickSlot(id);

  const slot = r.host.slots[id];
  assert.equal(slot.kind, "bot");
  assert.equal(slot.owner, null);
  assert.equal(r.guestSlot(), null);
  r.client.destroy();
  r.host.destroy();
});

test("the socket is closed after the message, not before it", async () => {
  const r = room();
  r.host.kickSlot(r.guestSlot()!.id);

  assert.equal(r.isClosed(), false, "closing immediately would cut the `kicked` message off");
  await wait(KICK_CLOSE_DELAY + 0.1);
  assert.equal(r.isClosed(), true, "and then the connection really does go");
  r.client.destroy();
  r.host.destroy();
});

test("the close that follows a kick doesn't report a second, different reason", async () => {
  const r = room();
  r.host.kickSlot(r.guestSlot()!.id);
  await wait(KICK_CLOSE_DELAY + 0.1);

  assert.equal(r.exits.length, 1, "one exit, not 'kicked' followed by 'host left'");
  assert.equal(r.exits[0].kicked, true);
  r.client.destroy();
  r.host.destroy();
});

test("losing the host is an exit too, and says so differently", () => {
  const r = room();
  r.dropHost();

  assert.equal(r.exits.length, 1);
  assert.equal(r.exits[0].kicked, false);
  assert.match(r.exits[0].reason, /host/i);
  r.client.destroy();
  r.host.destroy();
});

test("a screen mounting after the exit is not thrown back into the room", () => {
  const r = room();
  r.host.kickSlot(r.guestSlot()!.id);

  // setCallbacks replays the match a client is in, which is how a screen
  // resyncs on mount. After an exit there is nothing to replay.
  let replayed = false;
  r.client.setCallbacks({ onMatchStart: () => (replayed = true) });
  assert.equal(replayed, false);
  r.client.destroy();
  r.host.destroy();
});

test("the host cannot kick itself, and a bot slot is not kickable", () => {
  const r = room();
  const hostSlot = r.host.slots.find((s) => s.owner === "host")!;
  const botSlot = r.host.slots.find((s) => s.kind === "bot")!;

  r.host.kickSlot(hostSlot.id);
  r.host.kickSlot(botSlot.id);

  assert.equal(r.host.slots[hostSlot.id].owner, "host", "the host must keep its own slot");
  assert.equal(r.host.slots[botSlot.id].kind, "bot");
  assert.equal(
    r.toClient.some((m) => m.t === "kicked"),
    false,
    "neither is a kick, so nobody is told they were kicked",
  );
  assert.deepEqual(r.exits, []);
  r.client.destroy();
  r.host.destroy();
});

test("the guest's own slot is the one that gets kicked, not a neighbour", () => {
  const r = room();
  const id = r.guestSlot()!.id;
  const others = r.host.slots.filter((s) => s.id !== id).map((s) => s.kind);

  r.host.kickSlot(id);

  assert.deepEqual(
    r.host.slots.filter((s) => s.id !== id).map((s) => s.kind),
    others,
    "every other slot is untouched",
  );
  r.client.destroy();
  r.host.destroy();
});
