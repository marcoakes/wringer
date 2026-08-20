/**
 * What is in the cabinet.
 *
 * The games are real: each one is a self-contained page vendored from its own
 * repository under `games/`, unchanged. The cabinet does not modify them and
 * does not reach inside them.
 */

export const GAMES = [
  {
    id: "skyward-neon",
    title: "Skyward Neon",
    blurb: "A neon platformer over floating islands.",
    page: "games/skyward-neon/index.html",
  },
  {
    id: "pinball",
    title: "Pinball",
    blurb: "A from-scratch table with real capsule collision.",
    page: "games/pinball-5.5/index.html",
  },
  {
    id: "asteroids",
    title: "Asteroids",
    blurb: "Vector rocks, and the ship that regrets them.",
    page: "games/asteroids-5.5-oneshot/index.html",
  },
  {
    id: "neon-surge",
    title: "Neon Surge",
    blurb: "A bullet-heaven horde survival run.",
    page: "games/neon-surge/index.html",
  },
];

/** One game by id, or undefined. Never throws on an id nobody knows. */
export function find(id) {
  return GAMES.find((game) => game.id === id);
}

/** Every id the cabinet knows about, in cabinet order. */
export function ids() {
  return GAMES.map((game) => game.id);
}

/** True when this id is one the cabinet can actually launch. */
export function known(id) {
  return find(id) !== undefined;
}
