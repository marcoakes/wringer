# Arcade Cabinet

Four browser games behind one page. Open `index.html` and pick one.

The games are real and they are not mine to rewrite — each one is vendored
unchanged from its own repository under `games/`:

| game | from |
|---|---|
| Skyward Neon | [`marcoakes/skyward-neon`](https://github.com/marcoakes/skyward-neon) |
| Pinball | [`marcoakes/pinball-5.5`](https://github.com/marcoakes/pinball-5.5) |
| Asteroids | [`marcoakes/asteroids-5.5-oneshot`](https://github.com/marcoakes/asteroids-5.5-oneshot) |
| Neon Surge | [`marcoakes/neon-surge`](https://github.com/marcoakes/neon-surge) |

The cabinet itself is `index.html` plus two small modules in `src/`. It never
reaches inside a game.

## Running the checks

**No install step and no dependencies.** Node 18 or newer is all it needs.

```sh
npm test        # the suite that must stay green
npm run lint    # parses every file and checks a few rules that have bitten us
```

## How we work

`tests/` is the suite that must stay green. `npm test` runs exactly that.

`acceptance/` holds **executable specs**: checks written from a requirement
*before* it is built. They are red until the feature lands, which is why they
are deliberately not in the default run. Run one on its own:

```sh
node --test acceptance/recently-played.test.js
```

Right now that one fails, on purpose. `PRD.md` is the requirement it was
written from, and nothing in `src/` implements it yet.

**Why we bother.** A check written at the same time as the code it judges
passes because it was written to. A check that was already there, and is on the
record having *failed*, is the only kind that tells you the work did anything.
