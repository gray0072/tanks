// Room codes — SPEC §9.2. The code *is* the host's peer-id, so this is also
// what decides whether an invite link keeps working: a host that can name its
// own room keeps one link across reloads and evenings, instead of dictating a
// fresh six characters every time.
//
// Two alphabets, and the distinction is the point: what the game *generates*
// avoids characters people mishear, what a host *types* is accepted in full.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CODE_MAX_LEN,
  CODE_MIN_LEN,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  peerIdForRoom,
  roomCodeFromPeerId,
} from "../src/net/roomCode";
import { loopbackRoom } from "./netHelpers";

// --- what the game generates ----------------------------------------------

test("a generated code is 6 characters, valid, and free of look-alikes", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, 6);
    assert.ok(isValidRoomCode(code), `${code} should be valid`);
    // 0/O and 1/I/L are exactly the pairs that go wrong when a code is read
    // out over a call, which is the only way most guests receive one.
    assert.doesNotMatch(code, /[0O1IL]/, `${code} should avoid look-alike characters`);
  }
});

test("generated codes are not all the same code", () => {
  const seen = new Set(Array.from({ length: 50 }, generateRoomCode));
  assert.ok(seen.size > 40, `expected variety, got ${seen.size} distinct codes`);
});

// --- what a host may type -------------------------------------------------

test("a name is a perfectly good room code", () => {
  for (const name of ["SERGEY", "OLGA", "TANKS", "DVOR", "TEAM7"]) {
    assert.ok(isValidRoomCode(name), `${name} should be hostable`);
  }
});

test("typing is forgiving: case, spaces and punctuation are cleaned up", () => {
  assert.equal(normalizeRoomCode("sergey"), "SERGEY");
  assert.equal(normalizeRoomCode(" Sergey "), "SERGEY");
  assert.equal(normalizeRoomCode("k7qm-2x"), "K7QM2X");
  assert.equal(normalizeRoomCode("наш двор"), "", "nothing in the accepted alphabet survives");
});

test("a chosen code may contain the characters a generated one avoids", () => {
  // The exclusion exists so a *dictated* code isn't misheard. Refusing
  // someone's own name over it would be pedantry — this is the guard against
  // re-tightening the rule by accident.
  for (const code of ["OLIVIA", "LOLA", "I0O1L"]) {
    assert.ok(isValidRoomCode(code), `${code} should be accepted when typed`);
  }
});

test("codes have to be long enough to be a room and short enough to say", () => {
  assert.equal(isValidRoomCode("AB"), false, "too short");
  assert.equal(isValidRoomCode("ABC"), true, `${CODE_MIN_LEN} is the floor`);
  assert.equal(isValidRoomCode("A".repeat(CODE_MAX_LEN)), true);
  assert.equal(isValidRoomCode("A".repeat(CODE_MAX_LEN + 1)), false, "too long");
  assert.equal(isValidRoomCode(""), false);
  assert.equal(isValidRoomCode("SERGEY!"), false, "punctuation is not in the alphabet");
  assert.equal(normalizeRoomCode("A".repeat(40)).length, CODE_MAX_LEN, "typing past the limit stops at it");
});

test("a code round-trips through the peer-id it becomes", () => {
  for (const code of ["SERGEY", "K7QM2X", "ABC"]) {
    assert.equal(peerIdForRoom(code), `tanks-${code}`);
    assert.equal(roomCodeFromPeerId(peerIdForRoom(code)), code);
  }
  assert.equal(roomCodeFromPeerId("something-else"), null);
  assert.equal(roomCodeFromPeerId("tanks-AB"), null, "the code inside still has to be valid");
});

// --- hosting on a chosen code ---------------------------------------------

test("a host that asks for a code gets that code", () => {
  const r = loopbackRoom({ roomCode: "sergey" });
  assert.equal(r.host.roomCode, "SERGEY", "normalized, and used as asked");
  r.client.destroy();
  r.host.destroy();
});

test("a host that asks for nothing gets a generated code", () => {
  const r = loopbackRoom();
  assert.ok(r.host.roomCode && isValidRoomCode(r.host.roomCode));
  assert.equal(r.host.roomCode!.length, 6);
  r.client.destroy();
  r.host.destroy();
});

test("a generated code that collides is simply replaced — nobody is told", () => {
  const r = loopbackRoom();
  const first = r.host.roomCode;

  r.brokerRejectsCode();

  assert.ok(r.host.roomCode && isValidRoomCode(r.host.roomCode));
  assert.notEqual(r.host.roomCode, first, "the host should be on a different code now");
  assert.deepEqual(r.exits, [], "a collision the host never asked about is not their problem");
  r.client.destroy();
  r.host.destroy();
});

test("a chosen code that is taken is reported, not silently swapped", () => {
  const r = loopbackRoom({ roomCode: "SERGEY" });

  r.brokerRejectsCode();

  // Hosting under some other code would break the one thing a chosen code is
  // for: an invite link that keeps working.
  assert.equal(r.host.roomCode, "SERGEY");
  assert.equal(r.hostExits.length, 1);
  assert.match(r.hostExits[0].reason, /SERGEY/);
  assert.match(r.hostExits[0].reason, /in use/i);
  r.client.destroy();
  r.host.destroy();
});
