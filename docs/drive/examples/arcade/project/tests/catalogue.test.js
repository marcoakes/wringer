import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GAMES, find, ids, known } from "../src/catalogue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every game in the catalogue has a page that really exists", () => {
  for (const game of GAMES) {
    assert.ok(
      existsSync(join(ROOT, game.page)),
      `${game.id} points at ${game.page}, which is not in this repository`,
    );
  }
});

test("every game has an id, a title and a blurb", () => {
  for (const game of GAMES) {
    for (const field of ["id", "title", "blurb", "page"]) {
      assert.ok(game[field], `${game.id ?? "a game"} has no ${field}`);
    }
  }
});

test("ids are unique", () => {
  assert.equal(new Set(ids()).size, ids().length);
});

test("find returns the game, and undefined for one nobody knows", () => {
  assert.equal(find("pinball").title, "Pinball");
  assert.equal(find("no-such-game"), undefined);
});

test("known says which ids the cabinet can launch", () => {
  assert.equal(known("asteroids"), true);
  assert.equal(known("solitaire"), false);
});
