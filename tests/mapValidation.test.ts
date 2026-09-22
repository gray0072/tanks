// The level editor's validation rules (specs/level-editor.md §7). The headline
// one is reachability: a spawn walled in by steel or water is an error, a
// spawn reachable only through brick is fine — brick can always be shot open.
//
// The last test is the net under the rules themselves: a rule that rejects a
// built-in map is a wrong rule, however sensible it reads.

import test from "node:test";
import assert from "node:assert/strict";

import { validateMapTemplate, hasErrors, validateMapName } from "../src/world/maps/validateMap";
import { MAP_SOURCES } from "../src/world/maps/mapSources";

const errors = (template: string) =>
  validateMapTemplate(template).filter((p) => p.severity === "error").map((p) => p.message);
const warnings = (template: string) =>
  validateMapTemplate(template).filter((p) => p.severity === "warning").map((p) => p.message);

/** 10x10, two a side, nothing wrong with it. */
const BASE = [
  "@@@@@@@@@@",
  "@r......r@",
  "@..#..#..@",
  "@...R....@",
  "@...*....@",
  "@....*...@",
  "@....B...@",
  "@..#..#..@",
  "@b......b@",
  "@@@@@@@@@@",
].join("\n");

/** Swap one cell of BASE, so each case differs from a known-good map by
 *  exactly the thing it is testing. */
function withCell(template: string, cx: number, cy: number, glyph: string): string {
  const rows = template.split("\n");
  rows[cy] = rows[cy].slice(0, cx) + glyph + rows[cy].slice(cx + 1);
  return rows.join("\n");
}

test("a well-formed map has no errors", () => {
  assert.deepEqual(errors(BASE), []);
});

test("a spawn sealed in by steel is an error", () => {
  const sealed = [
    "@@@@@@@@@@",
    "@r@.....r@",
    "@@@#..#..@",
    "@...R....@",
    "@........@",
    "@........@",
    "@....B...@",
    "@..#..#..@",
    "@b......b@",
    "@@@@@@@@@@",
  ].join("\n");
  const msgs = errors(sealed);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /Red spawn at \(1,1\).*sealed in by steel/);
});

test("a spawn sealed in by water is an error", () => {
  const sealed = [
    "@@@@@@@@@@",
    "@r~.....r@",
    "@~~#..#..@",
    "@...R....@",
    "@........@",
    "@........@",
    "@....B...@",
    "@..#..#..@",
    "@b......b@",
    "@@@@@@@@@@",
  ].join("\n");
  const msgs = errors(sealed);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /Red spawn at \(1,1\).*water/);
});

test("a spawn reachable only through brick is fine — brick can be shot open", () => {
  const behindBrick = [
    "@@@@@@@@@@",
    "@r#.....r@",
    "@###..#..@",
    "@...R....@",
    "@........@",
    "@........@",
    "@....B...@",
    "@..#..#..@",
    "@b......b@",
    "@@@@@@@@@@",
  ].join("\n");
  assert.deepEqual(errors(behindBrick), []);
});

test("uneven teams warn but don't block", () => {
  const lopsided = withCell(BASE, 8, 1, ".");
  assert.deepEqual(errors(lopsided), []);
  assert.match(warnings(lopsided).join(" "), /Uneven teams: red has 1 spawn/);
});

test("each team needs exactly one flag", () => {
  assert.match(errors(withCell(BASE, 4, 3, ".")).join(" "), /No red flag/);
  assert.match(errors(withCell(BASE, 2, 4, "R")).join(" "), /2 red flags/);
});

test("enemy spawns may not start next to each other", () => {
  const facing = [
    "@@@@@@@@@@",
    "@r......r@",
    "@..#..#..@",
    "@...R....@",
    "@..rb....@",
    "@........@",
    "@....B...@",
    "@..#..#..@",
    "@b......b@",
    "@@@@@@@@@@",
  ].join("\n");
  assert.match(errors(facing).join(" "), /Red spawn \(3,4\) and blue spawn \(4,4\) are next to each other/);
});

test("the editor's size floor is enforced above the engine's", () => {
  // 4x4 parses fine for the engine (its floor is 2x2) but is not a match.
  const tiny = ["Rb..", "....", "....", "r..B"].join("\n");
  assert.match(errors(tiny).join(" "), /smaller than the 8×8 minimum/);
});

test("an unknown character is rejected", () => {
  assert.match(errors(withCell(BASE, 5, 5, "Z")).join(" "), /character the map format doesn't know/);
});

test("a flag on an open lane from an enemy spawn warns but doesn't block", () => {
  // Blue spawn at (1,8) and the red flag both on column 1, nothing but empty
  // cells between them.
  const exposed = [
    "@@@@@@@@@@",
    "@r......r@",
    "@..#..#..@",
    "@R.......@",
    "@...*....@",
    "@....*...@",
    "@....B...@",
    "@..#..#..@",
    "@b......b@",
    "@@@@@@@@@@",
  ].join("\n");
  assert.deepEqual(errors(exposed), []);
  assert.match(warnings(exposed).join(" "), /open line of fire/);
});

test("a map with no bonus spawns warns", () => {
  const noBonus = withCell(withCell(BASE, 4, 4, "."), 5, 5, ".");
  assert.deepEqual(errors(noBonus), []);
  assert.match(warnings(noBonus).join(" "), /No bonus spawn points/);
});

test("names must be present, short and unique", () => {
  assert.equal(validateMapName("Fortress", ["Swamp"]).length, 0);
  assert.match(validateMapName("  ", []).map((p) => p.message).join(" "), /needs a name/);
  assert.match(validateMapName("x".repeat(40), []).map((p) => p.message).join(" "), /longer than/);
  assert.match(validateMapName("Fortress", ["fortress"]).map((p) => p.message).join(" "), /already have a map/);
});

test("every built-in map passes the editor's rules", () => {
  for (const { id, template } of MAP_SOURCES) {
    const problems = validateMapTemplate(template);
    assert.equal(
      hasErrors(problems),
      false,
      `${id}: ${problems.filter((p) => p.severity === "error").map((p) => p.message).join("; ")}`,
    );
  }
});
