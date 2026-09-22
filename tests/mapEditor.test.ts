// The editor's document model (specs/level-editor.md §6) — painting rules,
// the terrain-only rectangle fill, resize with an anchor, and the one-step-per-
// gesture undo stack. Pure model, no DOM.

import test from "node:test";
import assert from "node:assert/strict";

import { EditorDoc, EditorModel } from "../src/world/maps/editorModel";
import { EDITOR_MAX_SPAWNS_PER_TEAM } from "../src/game/config";

const TEMPLATE = [
  "@@@@@@@@@@",
  "@r......r@",
  "@........@",
  "@...R....@",
  "@........@",
  "@........@",
  "@....B...@",
  "@........@",
  "@b......b@",
  "@@@@@@@@@@",
].join("\n");

test("a template round-trips through the model byte for byte", () => {
  assert.equal(EditorModel.fromTemplate(TEMPLATE).toTemplate(), TEMPLATE);
});

test("a blank map is valid the moment it is created", () => {
  const m = EditorModel.blank();
  assert.equal(m.count("R"), 1);
  assert.equal(m.count("B"), 1);
  assert.equal(m.count("r"), 1);
  assert.equal(m.count("b"), 1);
  assert.ok(m.count("*") > 0);
  assert.ok(m.hasSteelBorder());
});

test("painting one cell changes only that cell", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  assert.equal(m.paint(3, 4, "#"), "changed");
  assert.equal(m.at(3, 4), "#");
  assert.equal(m.at(4, 4), ".");
});

test("a rectangle fill covers exactly the dragged block and clamps at the edge", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  // Dragged from inside the map to well outside it.
  assert.equal(m.fillRect(2, 2, 20, 4, "%"), "changed");
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 9; x++) assert.equal(m.at(x, y), "%", `(${x},${y})`);
  }
  assert.equal(m.at(1, 3), ".", "the column left of the rectangle is untouched");
  assert.equal(m.at(2, 1), ".", "the row above it is untouched");
  assert.equal(m.at(2, 5), ".", "the row below it is untouched");
  assert.equal(m.count("R"), 0, "the fill swallowed the flag it covered");
  assert.equal(m.width, 10, "a fill never resizes the map");
});

test("a rectangle fill is refused for flags and spawns", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  assert.equal(m.fillRect(2, 2, 5, 5, "r"), "entity-rect");
  assert.equal(m.toTemplate(), TEMPLATE);
});

test("painting terrain over an entity removes it", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  assert.equal(m.count("r"), 2);
  m.paint(1, 1, "#");
  assert.equal(m.count("r"), 1);
  assert.equal(m.at(1, 1), "#");
});

test("the flag brush moves the flag instead of adding a second one", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  m.paint(7, 2, "R");
  assert.equal(m.count("R"), 1);
  assert.equal(m.at(7, 2), "R");
  assert.equal(m.at(4, 3), ".");
  // Dropping it where it already is does nothing — never a delete.
  assert.equal(m.paint(7, 2, "R"), "unchanged");
  assert.equal(m.count("R"), 1);
});

test("the spawn brush adds, toggles off, and stops at the per-team cap", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  m.paint(3, 5, "r");
  assert.equal(m.count("r"), 3);
  assert.equal(m.paint(3, 5, "r"), "changed");
  assert.equal(m.count("r"), 2, "a second click on the same spawn removes it");

  // Rows 4 and 5, inside the border: 16 free cells, enough to reach the cap
  // from the two spawns the template already has.
  const free: [number, number][] = [];
  for (const y of [4, 5]) for (let x = 1; x <= 8; x++) free.push([x, y]);
  let i = 0;
  while (m.count("r") < EDITOR_MAX_SPAWNS_PER_TEAM) {
    const [x, y] = free[i++];
    assert.equal(m.paint(x, y, "r"), "changed", `(${x},${y})`);
  }
  const [lx, ly] = free[i];
  assert.equal(m.paint(lx, ly, "r"), "spawn-limit");
  assert.equal(m.count("r"), EDITOR_MAX_SPAWNS_PER_TEAM);
});

test("a red spawn placed on a blue spawn replaces it", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  m.paint(1, 8, "r");
  assert.equal(m.at(1, 8), "r");
  assert.equal(m.count("b"), 1);
});

test("growing adds empty cells away from the anchor and keeps the steel frame", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  m.resize(14, 12, "start", "start");
  assert.equal(m.width, 14);
  assert.equal(m.height, 12);
  assert.equal(m.at(4, 3), "R", "content stays put with a top-left anchor");
  assert.ok(m.hasSteelBorder(), "the frame is redrawn on the new outer ring");
  assert.equal(m.count("r"), 2);
});

test("growing from the end anchor pushes the old content to the far corner", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  m.resize(14, 12, "end", "end");
  assert.equal(m.at(4 + 4, 3 + 2), "R");
});

test("shrinking drops what falls outside, and says so beforehand", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  // Top-left anchor: columns 8-9 and rows 8-9 go, taking one red spawn and
  // both blue ones with them.
  const loss = m.resizeLoss(8, 8, "start", "start");
  assert.equal(loss.entities, 3);
  m.resize(8, 8, "start", "start");
  assert.equal(m.width, 8);
  assert.equal(m.count("r"), 1);
  assert.equal(m.count("b"), 0);
});

test("resize never goes outside the editor's own bounds", () => {
  const m = EditorModel.fromTemplate(TEMPLATE);
  m.resize(2, 2, "start", "start");
  assert.equal(m.width, 8);
  assert.equal(m.height, 8);
  m.resize(999, 999, "start", "start");
  assert.equal(m.width, 64);
  assert.equal(m.height, 64);
});

test("one gesture is one undo step, whatever it touched", () => {
  const doc = EditorDoc.fromTemplate(TEMPLATE);
  // A drag: begin, many cells, end.
  doc.beginStroke();
  for (let x = 2; x <= 6; x++) doc.model.paint(x, 5, "#");
  assert.equal(doc.endStroke(), true);
  const painted = doc.template;

  doc.commit((m) => m.resize(12, 12, "start", "start"));
  assert.equal(doc.model.width, 12);

  assert.equal(doc.undo(), true);
  assert.equal(doc.template, painted, "one undo takes back the whole resize");
  assert.equal(doc.undo(), true);
  assert.equal(doc.template, TEMPLATE, "the next one takes back the whole drag");
  assert.equal(doc.canUndo, false);

  assert.equal(doc.redo(), true);
  assert.equal(doc.template, painted);
  assert.equal(doc.redo(), true);
  assert.equal(doc.model.width, 12);
  assert.equal(doc.canRedo, false);
});

test("a gesture that changed nothing isn't an undo step", () => {
  const doc = EditorDoc.fromTemplate(TEMPLATE);
  doc.commit((m) => m.paint(0, 0, "@")); // already steel
  assert.equal(doc.canUndo, false);
});

test("a new edit clears the redo stack", () => {
  const doc = EditorDoc.fromTemplate(TEMPLATE);
  doc.commit((m) => m.paint(3, 3, "#"));
  doc.undo();
  assert.equal(doc.canRedo, true);
  doc.commit((m) => m.paint(4, 4, "%"));
  assert.equal(doc.canRedo, false);
});
