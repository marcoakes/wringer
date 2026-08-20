import assert from "node:assert/strict";
import { test } from "node:test";

import { launchTarget, summary, tiles } from "../src/cabinet.js";

test("there is a tile for every game", () => {
  assert.equal(tiles().length, 4);
});

test("a tile carries what the page needs to draw it", () => {
  const tile = tiles()[0];
  for (const field of ["id", "title", "blurb", "page"]) {
    assert.ok(tile[field], `a tile has no ${field}`);
  }
});

test("picking a tile gives the page to open", () => {
  assert.equal(launchTarget("pinball"), "games/pinball-5.5/index.html");
});

test("picking something the cabinet does not know does nothing, and does not throw", () => {
  assert.equal(launchTarget("solitaire"), null);
});

test("the header says how many games there are", () => {
  assert.equal(summary(), "4 games");
});
