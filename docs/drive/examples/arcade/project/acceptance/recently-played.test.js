/**
 * The executable spec for "pick up where I left off".
 *
 * Written from the requirement BEFORE the requirement is built, which is why
 * `package.json` keeps this directory out of the default test run: `npm test`
 * is the suite that must stay green, and this one is allowed to be red until
 * the feature lands.
 *
 * Run it on its own:
 *
 *     node --test acceptance/
 *
 * It deliberately does NOT import a module that does not exist yet — a crash
 * on a missing file is a different failure from a feature that is absent, and
 * only the second one is what this is measuring. It asks the cabinet for the
 * functions and says plainly when they are not there.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as cabinet from "../src/cabinet.js";

/** A stand-in for the browser's localStorage: the same tiny surface. */
function fakeStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function required(name) {
  assert.equal(
    typeof cabinet[name],
    "function",
    `the cabinet has no ${name}() yet — "pick up where I left off" is not built`,
  );
  return cabinet[name];
}

test("the cabinet remembers a game it launched", () => {
  const record = required("recordLaunch");
  const recent = required("recentlyPlayed");
  const store = fakeStore();

  record(store, "pinball", 1000);

  assert.deepEqual(recent(store), ["pinball"]);
});

test("the most recently played comes first", () => {
  const record = required("recordLaunch");
  const recent = required("recentlyPlayed");
  const store = fakeStore();

  record(store, "pinball", 1000);
  record(store, "asteroids", 2000);
  record(store, "neon-surge", 3000);

  assert.deepEqual(recent(store), ["neon-surge", "asteroids", "pinball"]);
});

test("playing something again moves it, and does not list it twice", () => {
  const record = required("recordLaunch");
  const recent = required("recentlyPlayed");
  const store = fakeStore();

  record(store, "pinball", 1000);
  record(store, "asteroids", 2000);
  record(store, "pinball", 3000);

  assert.deepEqual(recent(store), ["pinball", "asteroids"]);
});

test("at most three are shown, and they are the three most recent", () => {
  const record = required("recordLaunch");
  const recent = required("recentlyPlayed");
  const store = fakeStore();

  record(store, "skyward-neon", 1000);
  record(store, "pinball", 2000);
  record(store, "asteroids", 3000);
  record(store, "neon-surge", 4000);

  assert.deepEqual(recent(store), ["neon-surge", "asteroids", "pinball"]);
});

test("it survives closing the page — the same store gives the same answer", () => {
  const record = required("recordLaunch");
  const recent = required("recentlyPlayed");
  const store = fakeStore();

  record(store, "pinball", 1000);
  record(store, "asteroids", 2000);
  const before = recent(store);

  // Nothing is held in memory between visits: a fresh reader of the SAME
  // store must see the same list.
  const after = recent(store);
  assert.deepEqual(after, before);
  assert.deepEqual(after, ["asteroids", "pinball"]);
});

test("a game that is no longer in the cabinet is quietly dropped", () => {
  const record = required("recordLaunch");
  const recent = required("recentlyPlayed");
  const store = fakeStore();

  record(store, "pinball", 1000);
  record(store, "a-game-we-removed", 2000);

  assert.deepEqual(
    recent(store),
    ["pinball"],
    "a stale entry must not appear in the row, and must not break it either",
  );
});

test("an empty cabinet history is an empty list, never an error", () => {
  const recent = required("recentlyPlayed");
  assert.deepEqual(recent(fakeStore()), []);
});

test("rubbish in the store does not take the cabinet down", () => {
  const recent = required("recentlyPlayed");
  const store = fakeStore();
  store.setItem("arcade.recent", "this is not json");

  assert.deepEqual(
    recent(store),
    [],
    "unreadable history should read as no history, not as a crash",
  );
});
