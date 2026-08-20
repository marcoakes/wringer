# Pinball 5.5

Browser-based pinball table built as a single static HTML/CSS/JS site and served directly from the repo root.

## Live URL

https://marcoakes.github.io/pinball-5.5/

## Controls

- Left flipper: Left Arrow or `Z`
- Right flipper: Right Arrow or `/`
- Plunger: Down Arrow or Space, hold to charge and release to fire
- Nudge: Shift
- Start / restart: Enter

## Physics Approach

- Engine: Planck.js from jsDelivr, because Box2D-style rigid bodies and revolute joints are a good fit for rotating flippers and high-speed ball contacts.
- Tunneling mitigations:
  - `bullet` enabled on the ball for continuous collision handling
  - fixed-step simulation with 6 physics substeps per render frame
  - thickened wall and guide geometry instead of zero-width line segments
  - capped ball speed after impulses and bumper kicks
- Flippers are dynamic rigid bodies on revolute joints with:
  - hard angular limits for up/down stops
  - strong motor torque and an angular impulse on press to mimic the solenoid hit
  - lower opposing torque and slower motor speed on release to mimic the return spring

## Features

- 3-ball game with auto-serve between drains
- Chargeable plunger lane
- Dual flippers, slingshots, pop bumpers, inlanes, outlanes, drop-target bank, and orbit lane
- “Overdrive” mode: completing the drop-target bank starts a 15-second 2x scoring window

## Sources

- Matthias Müller, Ten Minute Physics episode 04: segment and capsule collision framing
  - https://matthias-research.github.io/pages/tenMinutePhysics/04-pinball.html
- Erin Catto, GDC 2013 Continuous Collision
  - https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf
- Visual Pinball Engine flipper docs
  - https://docs.visualpinball.org/creators-guide/manual/mechanisms/flippers.html
