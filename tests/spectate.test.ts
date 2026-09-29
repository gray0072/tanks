// Spectating from the room (SPEC §6.1): clicking your own last slot hands it
// to a bot and leaves you in the room with no slot at all; clicking any bot
// slot afterwards hires it back. The old rule refused to release the last
// primary slot, so there was no way to watch a match without playing it.

import test from "node:test";
import assert from "node:assert/strict";

import { loopbackRoom as room } from "./netHelpers";

test("the host can release its last slot and becomes a spectator", () => {
  const r = room();
  const mine = r.host.mySlots();
  assert.equal(mine.length, 1, "the host starts seated");
  const id = mine[0].id;

  r.host.releaseSlot(id);

  assert.equal(r.host.mySlots().length, 0);
  assert.equal(r.host.slots[id].kind, "bot", "a bot takes the seat over");
  assert.equal(r.host.slots[id].owner, null);
  r.client.destroy();
  r.host.destroy();
});

test("a spectator hires any bot slot back", () => {
  const r = room();
  const id = r.host.mySlots()[0].id;
  r.host.releaseSlot(id);
  const bot = r.host.slots.find((s) => s.kind === "bot" && s.id !== id)!;

  r.host.claimSlot(bot.id);

  assert.deepEqual(r.host.mySlots().map((s) => s.id), [bot.id]);
  assert.equal(r.host.slots[id].kind, "bot", "the old seat stays a bot");
  r.client.destroy();
  r.host.destroy();
});

test("a guest can spectate too, and the guest's spectating doesn't block the start", () => {
  const r = room();
  const id = r.guestSlot()!.id;

  r.client.releaseSlot(id);

  assert.equal(r.guestSlot(), null, "the guest holds no slot");
  assert.equal(r.host.slots[id].kind, "bot");
  assert.equal(r.client.mySlots().length, 0, "and the guest's own view agrees");
  // Every human left in the roster is ready (the host is), so Start is open.
  assert.ok(r.host.slots.filter((s) => s.kind === "human" && s.owner !== "host").every((s) => s.ready));
  assert.deepEqual(r.exits, [], "spectating is not leaving the room");
  r.client.destroy();
  r.host.destroy();
});
