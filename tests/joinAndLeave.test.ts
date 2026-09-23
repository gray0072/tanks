// Arriving by invite link, and leaving without saying so — SPEC §6, §9.2, §9.4.
//
// Two bugs this is the guard for, both of them about the edges of a room's
// membership rather than about the game:
//
//  1. A `?room=CODE` link used to *connect on its own*, so the join form
//     flashed past and the player was seated under a `Guest1234` they never
//     chose, with no way back to change it. A link resolves to the form now.
//  2. A guest that closed its tab stayed in the host's roster forever: a
//     DataConnection's `close` event doesn't arrive when the page goes away
//     abruptly. The host watches the underlying WebRTC state instead
//     (net/liveness.ts), which is the part worth testing here — the PeerJS
//     plumbing around it needs two real browsers.

import test from "node:test";
import assert from "node:assert/strict";

import { deepLinkRoute } from "../src/ui/routes";
import { PeerWatchdog, type PeerConnState } from "../src/net/liveness";
import { PEER_DISCONNECT_GRACE } from "../src/game/config";

// --- 1. the invite link ----------------------------------------------------

test("an invite link lands on the join form with the code filled in", () => {
  const route = deepLinkRoute("?room=ABC234");
  assert.deepEqual(route, { k: "join", code: "ABC234" });
});

test("an invite link never lands in the room itself", () => {
  // The whole point of the fix: a link cannot know who is holding the phone,
  // so it must not commit them to a nickname.
  for (const search of ["?room=ABC234", "?room=abc234", "?room=abc-234&x=1"]) {
    const route = deepLinkRoute(search);
    assert.equal(route?.k, "join", `${search} should open the form`);
  }
});

test("a lowercase or punctuated code in a link still resolves", () => {
  assert.deepEqual(deepLinkRoute("?room=abc234"), { k: "join", code: "ABC234" });
  assert.deepEqual(deepLinkRoute("?room=ab-c2%2034"), { k: "join", code: "ABC234" });
});

test("no code, a malformed one, or an ambiguous letter is not a deep link", () => {
  // "ABC23" is too short, "ABC23O" uses a character the alphabet excludes on
  // purpose (roomCode.ts drops O/0/I/1/L), so neither is a room.
  for (const search of ["", "?x=1", "?room=", "?room=ABC23", "?room=ABC23O", "?room=TOOLONGCODE"]) {
    assert.equal(deepLinkRoute(search), null, `${search} should not be a deep link`);
  }
});

// --- 2. losing a peer that never said goodbye ------------------------------

const GRACE = PEER_DISCONNECT_GRACE;

/** Feeds one peer a sequence of states, one per second, and returns the
 *  second at which the watchdog first said to drop it (or null). */
function dropSecond(states: PeerConnState[], grace = GRACE): number | null {
  const watchdog = new PeerWatchdog(grace);
  for (let t = 0; t < states.length; t++) {
    if (watchdog.observe("guest", states[t], t) === "drop") return t;
  }
  return null;
}

test("a connected peer is kept, however long it stays", () => {
  assert.equal(dropSecond(new Array(120).fill("connected")), null);
});

test("a closed tab is dropped at once, without waiting out the grace", () => {
  // Chromium reports "failed" for a page that went away; "closed" is the
  // other end having torn the connection down properly.
  assert.equal(dropSecond(["connected", "connected", "failed"]), 2);
  assert.equal(dropSecond(["connected", "closed"]), 1);
});

test("a peer still setting up is not mistaken for a dead one", () => {
  assert.equal(dropSecond(["unknown", "new", "connecting", "connected"]), null);
});

test("a brief ICE blip is ridden out — a roaming phone must not lose its match", () => {
  const blip: PeerConnState[] = ["connected", "disconnected", "disconnected", "connected", "connected"];
  assert.equal(dropSecond(blip), null);
});

test("a peer that stays disconnected is dropped once the grace runs out", () => {
  const states: PeerConnState[] = ["connected", ...new Array(GRACE + 5).fill("disconnected")];
  // Disconnected from t=1, so the grace is up at t=1+GRACE.
  assert.equal(dropSecond(states), 1 + GRACE);
});

test("recovering resets the grace, so two blips don't add up to a drop", () => {
  const watchdog = new PeerWatchdog(4);
  assert.equal(watchdog.observe("guest", "disconnected", 0), "keep");
  assert.equal(watchdog.observe("guest", "disconnected", 3), "keep");
  assert.equal(watchdog.disconnectedFor("guest", 3), 3);
  // Back up, then straight down again: the clock starts from the new drop,
  // not from the first one, which was 3 seconds into a 4-second grace.
  assert.equal(watchdog.observe("guest", "connected", 4), "keep");
  assert.equal(watchdog.disconnectedFor("guest", 4), null);
  assert.equal(watchdog.observe("guest", "disconnected", 5), "keep");
  assert.equal(watchdog.observe("guest", "disconnected", 8), "keep", "only 3s into the new grace");
  assert.equal(watchdog.observe("guest", "disconnected", 9), "drop");
});

test("peers are judged one by one, not as a group", () => {
  const watchdog = new PeerWatchdog(2);
  assert.equal(watchdog.observe("a", "disconnected", 0), "keep");
  assert.equal(watchdog.observe("b", "connected", 0), "keep");
  assert.equal(watchdog.observe("a", "disconnected", 3), "drop");
  assert.equal(watchdog.observe("b", "connected", 3), "keep");
});

test("a peer that left by another route is forgotten, so its timer can't outlive it", () => {
  const watchdog = new PeerWatchdog(2);
  watchdog.observe("guest", "disconnected", 0);
  watchdog.forget("guest");
  assert.equal(watchdog.disconnectedFor("guest", 10), null);
  // A reconnecting peer reuses the id; it must start with a full grace.
  assert.equal(watchdog.observe("guest", "disconnected", 10), "keep");
  assert.equal(watchdog.observe("guest", "disconnected", 11), "keep");
  assert.equal(watchdog.observe("guest", "disconnected", 12), "drop");
});
