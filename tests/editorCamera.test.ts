// The level editor's zoom/pan camera (specs/level-editor.md §6.1) and the
// stroke cancel a pinch relies on (§6.9). Pure numbers, no DOM.

import test from "node:test";
import assert from "node:assert/strict";

import {
  cellUnder,
  centerOn,
  clampCamera,
  EDGE_MARGIN,
  fitCamera,
  FIT_MAX_CELL,
  MAX_CELL,
  showsWholeMap,
  zoomAt,
} from "../src/ui/editorCamera";
import { EditorDoc, EditorModel } from "../src/world/maps/editorModel";

const pane = { w: 800, h: 500 };
const map = { w: 40, h: 30 };

test("the fitted view shows the whole map, centered", () => {
  const c = fitCamera(pane, map);
  assert.equal(c.s, 500 / 30);
  assert.ok(showsWholeMap(c, pane, map));
  assert.ok(Math.abs(c.ox + (map.w * c.s) / 2 - pane.w / 2) < 1e-9);
  assert.equal(c.oy, 0);
});

test("a tiny map is fitted no bigger than the cap", () => {
  assert.equal(fitCamera(pane, { w: 2, h: 2 }).s, FIT_MAX_CELL);
});

test("zooming keeps the point under the cursor fixed", () => {
  const c0 = fitCamera(pane, map);
  const before = { x: (300 - c0.ox) / c0.s, y: (200 - c0.oy) / c0.s };
  const c1 = zoomAt(c0, 2, 300, 200, pane, map);
  assert.equal(c1.s, c0.s * 2);
  assert.ok(Math.abs((300 - c1.ox) / c1.s - before.x) < 1e-9);
  assert.ok(Math.abs((200 - c1.oy) / c1.s - before.y) < 1e-9);
  assert.ok(!showsWholeMap(c1, pane, map));
});

test("zoom is bounded: never below fit, never past the maximum", () => {
  const fit = fitCamera(pane, map);
  assert.equal(zoomAt(fit, 0.1, 0, 0, pane, map).s, fit.s);
  assert.equal(zoomAt(fit, 100, 0, 0, pane, map).s, MAX_CELL);
});

test("an overflowing map can't be dragged out of sight", () => {
  const c = clampCamera({ s: 40, ox: 5000, oy: -5000 }, pane, map);
  assert.equal(c.ox, EDGE_MARGIN);
  assert.equal(c.oy, pane.h - map.h * 40 - EDGE_MARGIN);
});

test("centerOn puts a map point in the middle of the pane", () => {
  const c = centerOn({ s: 40, ox: 0, oy: 0 }, 20, 15, pane, map);
  const cell = cellUnder(c, pane.w / 2, pane.h / 2);
  assert.deepEqual(cell, { cx: 20, cy: 15 });
});

test("a cancelled stroke leaves neither the paint nor an undo step behind", () => {
  const doc = new EditorDoc(EditorModel.blank());
  const before = doc.template;
  doc.beginStroke();
  doc.model.paint(3, 3, "#");
  assert.notEqual(doc.template, before);
  assert.equal(doc.cancelStroke(), true);
  assert.equal(doc.template, before);
  assert.equal(doc.canUndo, false);
  // And the next stroke starts clean.
  assert.equal(doc.endStroke(), false);
});
