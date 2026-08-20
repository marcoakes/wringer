/**
 * The cabinet itself: what to show, and what happens when you pick something.
 *
 * Everything here is a plain function over plain data so it can be tested
 * without a browser. The page in `index.html` is a thin shell that calls it.
 */

import { GAMES, find, known } from "./catalogue.js";

/** The tiles to draw, in cabinet order. */
export function tiles() {
  return GAMES.map((game) => ({
    id: game.id,
    title: game.title,
    blurb: game.blurb,
    page: game.page,
  }));
}

/**
 * Where picking a tile should send the browser, or null if the cabinet does
 * not know that game.
 *
 * Null rather than a thrown error: a stale link should do nothing, not take
 * the whole cabinet down with it.
 */
export function launchTarget(id) {
  const game = find(id);
  return game ? game.page : null;
}

/** A short line for the header. */
export function summary() {
  return `${GAMES.length} games`;
}

export { known };
