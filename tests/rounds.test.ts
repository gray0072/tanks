// The match series — SPEC §2.2. A round is one fight; the match is the series,
// and the first team to the room's `winsTarget` takes it.
//
// The host drives the series (net/host.ts) but owns none of the rules: what a
// round win does to the score, when a match is decided and how a drawn round
// is treated all live in world/series.ts, which is what this exercises.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_WINS_TARGET, WINS_TARGET_OPTIONS, winsTargetLabel } from "../src/game/config";
import {
  addRoundStats,
  createSeries,
  recordRound,
  seriesScoreLabel,
  seriesWinner,
} from "../src/world/series";
import { checkWinByTime, createRules, createStats, type MatchRules } from "../src/world/rules";
import { createDefaultSlots } from "../src/world/tank";

const SLOTS = createDefaultSlots("host", 2, 2);

test("the room offers 1..10 rounds and defaults to 5", () => {
  assert.deepEqual(WINS_TARGET_OPTIONS, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(DEFAULT_WINS_TARGET, 5);
  assert.ok(WINS_TARGET_OPTIONS.includes(DEFAULT_WINS_TARGET));
  assert.equal(winsTargetLabel(5), "first to 5");
});

test("a round win moves the score and the target decides the match", () => {
  const series = createSeries(3, SLOTS);
  assert.equal(seriesWinner(series), null);

  recordRound(series, "blue");
  recordRound(series, "red");
  recordRound(series, "blue");
  assert.deepEqual(series.wins, { blue: 2, red: 1 });
  assert.equal(series.round, 4);
  assert.equal(seriesWinner(series), null, "2 of 3 is not a match win yet");

  recordRound(series, "blue");
  assert.equal(seriesWinner(series), "blue");
  assert.equal(seriesScoreLabel(series.wins, "blue"), "3:1");
});

test("a first-to-1 room is decided by its first round", () => {
  const series = createSeries(1, SLOTS);
  recordRound(series, "red");
  assert.equal(seriesWinner(series), "red");
  assert.equal(seriesScoreLabel(series.wins, "red"), "1:0");
});

test("the score reads winner-first, whichever team won", () => {
  const series = createSeries(2, SLOTS);
  recordRound(series, "red");
  recordRound(series, "blue");
  recordRound(series, "red");
  assert.equal(seriesScoreLabel(series.wins, "red"), "2:1");
  // A match nobody took (an abandoned series) still reads blue-first.
  assert.equal(seriesScoreLabel(series.wins, null), "1:2");
});

test("stats add up over the series rather than showing only the last round", () => {
  const series = createSeries(2, SLOTS);
  const round = (frags: number, deaths: number) => ({ 0: { ...createStats(), frags, deaths } });

  addRoundStats(series, round(3, 1));
  addRoundStats(series, round(2, 4));

  assert.equal(series.stats[0].frags, 5);
  assert.equal(series.stats[0].deaths, 5);
  // A slot the series never started with (a guest seated mid-match) is taken
  // as it comes rather than dropped.
  addRoundStats(series, { 99: { ...createStats(), frags: 1 } });
  assert.equal(series.stats[99].frags, 1);
});

// --- how a round the clock ran out on is decided (SPEC §2.2) ---------------

/** MatchRules for a 1v1 with the given respawn pools, clock already at 0. */
function timedOut(blueRespawns: number, redRespawns: number): MatchRules {
  const slots = createDefaultSlots("host", 1, 1);
  const rules = createRules(
    { mapId: "m", winsTarget: 5, timeLimit: 60, respawnMult: 0, friendlyFire: false },
    slots,
  );
  rules.respawns.blue = blueRespawns;
  rules.respawns.red = redRespawns;
  rules.timeLeft = 0;
  return rules;
}

const LEVEL = { blue: 100, red: 100 };

test("time out goes to the team with more respawns left", () => {
  const blueAhead = timedOut(7, 3);
  checkWinByTime(blueAhead, LEVEL);
  assert.equal(blueAhead.ended, true);
  assert.equal(blueAhead.winner, "blue");

  const redAhead = timedOut(3, 7);
  checkWinByTime(redAhead, LEVEL);
  assert.equal(redAhead.winner, "red");
});

test("level on respawns, the round goes to whoever got closest to the enemy flag", () => {
  const rules = timedOut(5, 5);
  checkWinByTime(rules, { blue: 400, red: 90 });
  assert.equal(rules.ended, true);
  assert.equal(rules.winner, "red", "red's nearest tank was deeper into blue's base");
});

test("a team with nothing alive is infinitely far from the flag, so it loses the tie", () => {
  const rules = timedOut(5, 5);
  checkWinByTime(rules, { blue: 800, red: Infinity });
  assert.equal(rules.winner, "blue");
});

test("dead level goes to sudden death rather than a draw — the round keeps running", () => {
  const rules = timedOut(5, 5);
  checkWinByTime(rules, LEVEL);
  assert.equal(rules.ended, false, "the round must not end level");
  assert.equal(rules.winner, null);
  assert.equal(rules.suddenDeath, true);

  // Next tick: a tank moves, and that is enough to settle it.
  checkWinByTime(rules, { blue: 99, red: 100 });
  assert.equal(rules.ended, true);
  assert.equal(rules.winner, "blue");
});

test("respawns outrank position: a team can be at the flag and still lose on lives", () => {
  const rules = timedOut(9, 2);
  checkWinByTime(rules, { blue: 900, red: 10 });
  assert.equal(rules.winner, "blue");
});
