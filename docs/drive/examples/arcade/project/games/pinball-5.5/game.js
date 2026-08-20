const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const pl = planck;
const Vec2 = pl.Vec2;

const WORLD_W = 10;
const WORLD_H = 20;
const SCALE = 70;
const OFFSET_X = (canvas.width - WORLD_W * SCALE) / 2;
const OFFSET_Y = 40;

const FIXED_STEP = 1 / 60;
const SUBSTEPS = 6;
const SUBSTEP_DT = FIXED_STEP / SUBSTEPS;
const VELOCITY_ITERS = 8;
const POSITION_ITERS = 3;

const BALL_RADIUS = 0.18;
const MAX_BALL_SPEED = 22;
const MAX_BUMPER_EXIT = 18.5;
const MAX_SLING_EXIT = 17;
const TOTAL_BALLS = 3;

const keys = new Set();

let audioCtx = null;
let accumulator = 0;
let lastTime = performance.now();

let world;
let table;

const state = {
  screen: "title",
  score: 0,
  highScore: 0,
  ballNumber: 1,
  ballsRemaining: TOTAL_BALLS,
  serveTimer: 0,
  messageTimer: 0,
  messageText: "",
  launchCharge: 0,
  mode: "idle",
  modeTimer: 0,
  nudgeCooldown: 0,
};

const input = {
  left: false,
  right: false,
  plunger: false,
  plungerPrev: false,
  nudgePrev: false,
};

function maybeInitAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function tone(freq, duration, type = "triangle", volume = 0.035) {
  if (!audioCtx) {
    return;
  }
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toScreen(v) {
  return {
    x: OFFSET_X + v.x * SCALE,
    y: OFFSET_Y + v.y * SCALE,
  };
}

function addScore(base) {
  const multiplier = state.mode === "overdrive" ? 2 : 1;
  state.score += base * multiplier;
  if (state.score > state.highScore) {
    state.highScore = state.score;
  }
}

function setMessage(text, duration = 1.2) {
  state.messageText = text;
  state.messageTimer = duration;
}

function capBallSpeed(ball, maxSpeed = MAX_BALL_SPEED) {
  const v = ball.body.getLinearVelocity();
  const speed = v.length();
  if (speed > maxSpeed) {
    ball.body.setLinearVelocity(v.mul(maxSpeed / speed));
  }
}

function createStaticSegment(body, ax, ay, bx, by, thickness, userData = null, sensor = false) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const fixture = body.createFixture(
    pl.Box(length / 2, thickness / 2, Vec2((ax + bx) / 2, (ay + by) / 2), angle),
    {
      density: 0,
      friction: 0.15,
      restitution: 0.82,
      isSensor: sensor,
    },
  );
  fixture.setUserData(userData);
  return fixture;
}

function createCircleFixture(body, x, y, radius, options, userData = null) {
  const fixture = body.createFixture(pl.Circle(Vec2(x, y), radius), options);
  fixture.setUserData(userData);
  return fixture;
}

function createBoxFixture(body, hx, hy, x, y, angle, options, userData = null) {
  const fixture = body.createFixture(pl.Box(hx, hy, Vec2(x, y), angle), options);
  fixture.setUserData(userData);
  return fixture;
}

function createBall(x, y) {
  const body = world.createDynamicBody({
    position: Vec2(x, y),
    bullet: true,
    linearDamping: 0.22,
    angularDamping: 0.8,
  });
  body.createFixture(pl.Circle(BALL_RADIUS), {
    density: 1.05,
    friction: 0.03,
    restitution: 0.77,
  });
  const ball = {
    kind: "ball",
    body,
    flash: 0,
    inPlunger: false,
  };
  body.setUserData(ball);
  table.balls.push(ball);
  return ball;
}

function destroyBall(ball) {
  const index = table.balls.indexOf(ball);
  if (index >= 0) {
    table.balls.splice(index, 1);
  }
  world.destroyBody(ball.body);
}

function resetMode() {
  state.mode = "idle";
  state.modeTimer = 0;
}

function startOverdrive() {
  state.mode = "overdrive";
  state.modeTimer = 15;
  setMessage("OVERDRIVE 2X", 1.8);
  tone(720, 0.18, "sawtooth", 0.045);
  tone(960, 0.25, "triangle", 0.035);
}

function resetDropTargets() {
  for (const target of table.dropTargets) {
    target.down = false;
    target.body.setActive(true);
    target.flash = 0;
  }
}

function markDropTarget(target) {
  if (target.down) {
    return;
  }
  target.down = true;
  target.flash = 0.4;
  target.body.setActive(false);
  addScore(1000);
  tone(540, 0.08, "square", 0.03);

  if (table.dropTargets.every((item) => item.down)) {
    addScore(5000);
    startOverdrive();
    table.dropResetTimer = 2.4;
    setMessage("BANK COMPLETE", 1.4);
  }
}

function fireBumper(bumper, ball) {
  const center = bumper.body.getPosition();
  const ballPos = ball.body.getPosition();
  let impulse = ballPos.sub(center);
  if (impulse.lengthSquared() < 0.0001) {
    impulse = Vec2(rand(-1, 1), -1);
  }
  impulse = impulse.mul(1 / impulse.length());
  const kick = 5.6;
  ball.body.applyLinearImpulse(impulse.mul(kick), ballPos, true);
  capBallSpeed(ball, MAX_BUMPER_EXIT);
  bumper.flash = 0.22;
  addScore(750);
  tone(800, 0.05, "triangle", 0.045);
}

function fireSlingshot(sling, ball) {
  const pos = ball.body.getPosition();
  const kick = sling.side === "left" ? Vec2(2.6, -5.8) : Vec2(-2.6, -5.8);
  ball.body.applyLinearImpulse(kick, pos, true);
  capBallSpeed(ball, MAX_SLING_EXIT);
  sling.flash = 0.16;
  addScore(250);
  tone(460, 0.05, "square", 0.03);
}

function beginDrain(ball) {
  if (table.drainingBall) {
    return;
  }
  table.drainingBall = ball;
  table.drainTimer = 0.45;
  setMessage("BALL LOST", 1);
  tone(180, 0.18, "sawtooth", 0.05);
  tone(130, 0.22, "triangle", 0.035);
}

function advanceBall() {
  if (table.balls.length > 0) {
    for (const ball of [...table.balls]) {
      destroyBall(ball);
    }
  }
  table.drainingBall = null;
  state.ballsRemaining -= 1;
  if (state.ballsRemaining <= 0) {
    state.screen = "gameover";
    resetMode();
    return;
  }
  state.ballNumber += 1;
  state.serveTimer = 1.2;
}

function serveBall() {
  if (table.balls.length > 0) {
    return;
  }
  createBall(9.1, 17.25);
  setMessage(`BALL ${state.ballNumber}`, 1);
}

function createFlipper(side, pivotX, pivotY) {
  const dir = side === "left" ? 1 : -1;
  const startAngle = side === "left" ? 0.36 : -0.36;
  const body = world.createDynamicBody({
    position: Vec2(pivotX, pivotY),
    angle: startAngle,
    type: "dynamic",
    allowSleep: false,
  });
  const material = {
    density: 4.2,
    friction: 0.9,
    restitution: 0.12,
  };
  createBoxFixture(body, 0.72, 0.13, 0.72 * dir, 0, 0, material);
  createCircleFixture(body, 0.12 * dir, 0, 0.19, material);
  createCircleFixture(body, 1.44 * dir, 0, 0.16, material);

  const joint = world.createJoint(pl.RevoluteJoint({
    enableLimit: true,
    lowerAngle: side === "left" ? -1.02 : 0,
    upperAngle: side === "left" ? 0 : 1.02,
    enableMotor: true,
    motorSpeed: 0,
    maxMotorTorque: 0,
  }, table.ground, body, Vec2(pivotX, pivotY)));

  const flipper = {
    side,
    dir,
    body,
    joint,
    coil: 0,
    flash: 0,
    baseTorque: 135,
    engagedSpeed: 22,
    returnSpeed: 8,
    returnRatio: 0.1,
  };
  body.setUserData({ kind: "flipper", ref: flipper });
  return flipper;
}

function createCircleBody(x, y, radius, options, userData) {
  const body = world.createBody({ position: Vec2(x, y) });
  body.createFixture(pl.Circle(radius), options);
  body.setUserData(userData);
  return body;
}

function createTriangleSensor(points, userData) {
  const body = world.createBody();
  const fixture = body.createFixture(pl.Polygon(points.map(([x, y]) => Vec2(x, y))), {
    isSensor: true,
  });
  fixture.setUserData(userData);
  return body;
}

function buildTable() {
  world = new pl.World(Vec2(0, 11.5));
  table = {
    ground: world.createBody(),
    balls: [],
    flippers: [],
    bumpers: [],
    slingshots: [],
    dropTargets: [],
    triggers: [],
    orbitGuides: [],
    drainingBall: null,
    drainTimer: 0,
    dropResetTimer: 0,
    leftLatch: false,
    rightLatch: false,
    stars: Array.from({ length: 90 }, () => ({
      x: rand(50, canvas.width - 50),
      y: rand(60, canvas.height - 60),
      a: rand(0.08, 0.28),
      r: rand(1, 2.4),
    })),
  };

  const wall = table.ground;
  const thick = 0.22;

  createStaticSegment(wall, 1.0, 1.0, 1.0, 18.9, thick);
  createStaticSegment(wall, 1.0, 1.0, 8.1, 1.0, thick);
  createStaticSegment(wall, 8.1, 1.0, 8.1, 2.6, thick);
  createStaticSegment(wall, 8.1, 2.6, 8.45, 2.95, thick);
  createStaticSegment(wall, 8.45, 2.95, 8.45, 19.05, thick);
  createStaticSegment(wall, 9.75, 1.0, 9.75, 19.05, thick);
  createStaticSegment(wall, 8.45, 1.0, 9.75, 1.0, thick);
  createStaticSegment(wall, 8.45, 19.05, 9.75, 19.05, thick);

  createStaticSegment(wall, 1.0, 18.9, 2.2, 18.9, thick);
  createStaticSegment(wall, 2.2, 18.9, 3.0, 17.2, thick);
  createStaticSegment(wall, 3.0, 17.2, 3.65, 16.45, thick);
  createStaticSegment(wall, 6.35, 16.45, 7.0, 17.2, thick);
  createStaticSegment(wall, 7.0, 17.2, 7.8, 18.9, thick);
  createStaticSegment(wall, 7.8, 18.9, 9.0, 18.9, thick);

  createStaticSegment(wall, 2.05, 18.9, 2.05, 15.4, 0.14);
  createStaticSegment(wall, 2.05, 15.4, 2.75, 14.6, 0.14);
  createStaticSegment(wall, 2.75, 14.6, 3.25, 15.7, 0.14);
  createStaticSegment(wall, 3.25, 15.7, 3.95, 15.45, 0.14);

  createStaticSegment(wall, 7.95, 18.9, 7.95, 15.4, 0.14);
  createStaticSegment(wall, 7.95, 15.4, 7.25, 14.6, 0.14);
  createStaticSegment(wall, 7.25, 14.6, 6.75, 15.7, 0.14);
  createStaticSegment(wall, 6.75, 15.7, 6.05, 15.45, 0.14);

  createStaticSegment(wall, 1.55, 3.3, 1.55, 14.6, 0.12);
  createStaticSegment(wall, 2.25, 3.0, 2.25, 14.1, 0.12);
  createStaticSegment(wall, 1.55, 3.3, 2.25, 3.0, 0.12);
  createStaticSegment(wall, 2.25, 14.1, 3.35, 15.2, 0.12);

  createStaticSegment(wall, 8.45, 2.95, 9.0, 4.6, 0.12);
  createStaticSegment(wall, 8.95, 4.6, 8.95, 14.45, 0.12);
  createStaticSegment(wall, 8.45, 14.45, 8.95, 14.45, 0.12);
  createStaticSegment(wall, 8.45, 15.2, 9.0, 15.2, 0.12);

  createStaticSegment(wall, 2.55, 6.7, 4.1, 5.55, 0.12);
  createStaticSegment(wall, 5.9, 5.55, 7.5, 6.7, 0.12);
  createStaticSegment(wall, 4.1, 5.55, 5.0, 4.15, 0.12);
  createStaticSegment(wall, 5.0, 4.15, 5.9, 5.55, 0.12);

  createStaticSegment(wall, 4.55, 7.7, 5.45, 7.7, 0.12);
  createStaticSegment(wall, 4.4, 8.9, 5.6, 8.9, 0.12);

  const leftSlingBody = world.createBody();
  leftSlingBody.createFixture(pl.Polygon([Vec2(2.55, 14.85), Vec2(3.9, 14.6), Vec2(3.15, 16.0)]), {
    density: 0,
    friction: 0.12,
    restitution: 0.86,
  });
  const rightSlingBody = world.createBody();
  rightSlingBody.createFixture(pl.Polygon([Vec2(7.45, 14.85), Vec2(6.1, 14.6), Vec2(6.85, 16.0)]), {
    density: 0,
    friction: 0.12,
    restitution: 0.86,
  });

  const leftSling = { side: "left", flash: 0 };
  const rightSling = { side: "right", flash: 0 };
  createTriangleSensor([[2.4, 14.55], [4.05, 14.45], [3.15, 16.2]], { kind: "sling", ref: leftSling });
  createTriangleSensor([[7.6, 14.55], [5.95, 14.45], [6.85, 16.2]], { kind: "sling", ref: rightSling });
  table.slingshots.push(leftSling, rightSling);

  for (const [x, y] of [[3.2, 5.15], [5.0, 4.2], [6.8, 5.15]]) {
    const bumper = {
      body: createCircleBody(x, y, 0.35, { friction: 0, restitution: 0.92 }, null),
      radius: 0.52,
      flash: 0,
    };
    const sensor = bumper.body.createFixture(pl.Circle(0.52), {
      isSensor: true,
    });
    sensor.setUserData({ kind: "bumper", ref: bumper });
    table.bumpers.push(bumper);
  }

  for (const x of [6.45, 7.0, 7.55]) {
    const body = world.createBody({ position: Vec2(x, 7.95) });
    createBoxFixture(body, 0.18, 0.42, 0, 0, 0, {
      density: 0,
      friction: 0.12,
      restitution: 0.78,
    }, { kind: "dropTarget" });
    const target = {
      body,
      down: false,
      flash: 0,
    };
    body.setUserData({ kind: "dropTarget", ref: target });
    table.dropTargets.push(target);
  }

  const leftFlipper = createFlipper("left", 3.45, 17.15);
  const rightFlipper = createFlipper("right", 6.55, 17.15);
  table.flippers.push(leftFlipper, rightFlipper);

  createStaticSegment(wall, 4.25, 17.95, 4.95, 18.7, 0.12);
  createStaticSegment(wall, 5.75, 17.95, 5.05, 18.7, 0.12);

  createStaticSegment(wall, 8.47, 16.55, 8.47, 18.9, 0.09);
  createStaticSegment(wall, 9.73, 16.55, 9.73, 18.9, 0.09);

  createBoxFixture(wall, 0.75, 0.18, 8.63, 15.7, 0, { isSensor: true }, { kind: "lane", points: 500, text: "INLANE" });
  createBoxFixture(wall, 0.75, 0.18, 1.37, 15.7, 0, { isSensor: true }, { kind: "lane", points: 500, text: "INLANE" });
  createBoxFixture(wall, 0.4, 0.22, 2.25, 17.75, 0, { isSensor: true }, { kind: "lane", points: 1000, text: "OUTLANE" });
  createBoxFixture(wall, 0.4, 0.22, 7.75, 17.75, 0, { isSensor: true }, { kind: "lane", points: 1000, text: "OUTLANE" });
  createBoxFixture(wall, 0.36, 0.25, 1.9, 3.4, 0, { isSensor: true }, { kind: "orbit", points: 1500, text: "ORBIT" });
  createBoxFixture(wall, 0.52, 0.22, 4.98, 18.98, 0, { isSensor: true }, { kind: "drain" });
  createBoxFixture(wall, 0.5, 1.35, 9.1, 16.95, 0, { isSensor: true }, { kind: "plungerLane" });

  world.on("begin-contact", (contact) => {
    const fixtureA = contact.getFixtureA();
    const fixtureB = contact.getFixtureB();
    const bodyA = fixtureA.getBody().getUserData();
    const bodyB = fixtureB.getBody().getUserData();
    const userA = fixtureA.getUserData() || bodyA;
    const userB = fixtureB.getUserData() || bodyB;

    handleBeginContact(userA, bodyA, userB, bodyB);
    handleBeginContact(userB, bodyB, userA, bodyA);
  });

  world.on("end-contact", (contact) => {
    const fixtureA = contact.getFixtureA();
    const fixtureB = contact.getFixtureB();
    const bodyA = fixtureA.getBody().getUserData();
    const bodyB = fixtureB.getBody().getUserData();
    const userA = fixtureA.getUserData() || bodyA;
    const userB = fixtureB.getUserData() || bodyB;

    handleEndContact(userA, bodyA, userB, bodyB);
    handleEndContact(userB, bodyB, userA, bodyA);
  });
}

function handleBeginContact(primary, primaryBody, other, otherBody) {
  if (!primary || !otherBody || otherBody.kind !== "ball") {
    return;
  }

  if (primary.kind === "bumper") {
    fireBumper(primary.ref, otherBody);
  } else if (primary.kind === "sling") {
    fireSlingshot(primary.ref, otherBody);
  } else if (primary.kind === "dropTarget") {
    markDropTarget(primaryBody.ref);
  } else if (primary.kind === "lane") {
    addScore(primary.points);
    setMessage(primary.text, 0.6);
    tone(620, 0.04, "triangle", 0.025);
  } else if (primary.kind === "orbit") {
    addScore(primary.points);
    setMessage(primary.text, 0.8);
    tone(720, 0.05, "triangle", 0.03);
  } else if (primary.kind === "drain") {
    beginDrain(otherBody);
  } else if (primary.kind === "plungerLane") {
    otherBody.inPlunger = true;
  }
}

function handleEndContact(primary, primaryBody, other, otherBody) {
  if (!primary || !otherBody || otherBody.kind !== "ball") {
    return;
  }
  if (primary.kind === "plungerLane") {
    otherBody.inPlunger = false;
  }
}

function startGame() {
  state.screen = "playing";
  state.score = 0;
  state.ballNumber = 1;
  state.ballsRemaining = TOTAL_BALLS;
  state.serveTimer = 0.4;
  state.messageTimer = 0;
  state.launchCharge = 0;
  state.nudgeCooldown = 0;
  resetMode();
  buildTable();
  resetDropTargets();
}

function updateFlipper(flipper, pressed, dt) {
  const stroke = pressed ? 1 : 0;
  const ramp = 0.03;
  if (stroke > flipper.coil) {
    flipper.coil = Math.min(1, flipper.coil + dt / ramp);
  } else {
    flipper.coil = Math.max(0, flipper.coil - dt / 0.06);
  }

  const jointAngle = flipper.joint.getJointAngle();
  const nearEnd = Math.abs(jointAngle) > 0.92;

  if (pressed) {
    const speed = flipper.side === "left" ? -flipper.engagedSpeed : flipper.engagedSpeed;
    flipper.joint.setMotorSpeed(nearEnd ? speed * 0.08 : speed);
    flipper.joint.setMaxMotorTorque(flipper.baseTorque * (nearEnd ? 0.28 : 0.35 + flipper.coil * 0.65));
  } else {
    const speed = flipper.side === "left" ? flipper.returnSpeed : -flipper.returnSpeed;
    flipper.joint.setMotorSpeed(speed);
    flipper.joint.setMaxMotorTorque(flipper.baseTorque * flipper.returnRatio);
  }

  flipper.flash = Math.max(0, flipper.flash - dt);
}

function handleInputEdges() {
  const leftPressed = keys.has("ArrowLeft") || keys.has("KeyZ");
  const rightPressed = keys.has("ArrowRight") || keys.has("Slash");
  const plungerPressed = keys.has("ArrowDown") || keys.has("Space");
  const nudgePressed = keys.has("ShiftLeft") || keys.has("ShiftRight");

  input.left = leftPressed;
  input.right = rightPressed;
  input.plunger = plungerPressed;

  if (state.screen === "playing") {
    if (leftPressed && !table.leftLatch) {
      table.leftLatch = true;
      table.flippers[0].body.applyAngularImpulse(-1.8, true);
      table.flippers[0].flash = 0.12;
      tone(240, 0.03, "square", 0.028);
    } else if (!leftPressed) {
      table.leftLatch = false;
    }

    if (rightPressed && !table.rightLatch) {
      table.rightLatch = true;
      table.flippers[1].body.applyAngularImpulse(1.8, true);
      table.flippers[1].flash = 0.12;
      tone(250, 0.03, "square", 0.028);
    } else if (!rightPressed) {
      table.rightLatch = false;
    }

    if (!plungerPressed && input.plungerPrev && state.launchCharge > 0.05) {
      const ball = table.balls.find((item) => item.inPlunger);
      if (ball) {
        const impulse = Vec2(0, -(6 + state.launchCharge * 13));
        ball.body.applyLinearImpulse(impulse, ball.body.getWorldCenter(), true);
        capBallSpeed(ball, 19);
        tone(180 + state.launchCharge * 260, 0.09, "sawtooth", 0.04);
      }
      state.launchCharge = 0;
    }

    if (nudgePressed && !input.nudgePrev && state.nudgeCooldown <= 0) {
      for (const ball of table.balls) {
        ball.body.applyLinearImpulse(Vec2(rand(-0.7, 0.7), -1.2), ball.body.getWorldCenter(), true);
        capBallSpeed(ball);
      }
      state.nudgeCooldown = 0.45;
      tone(160, 0.04, "triangle", 0.02);
    }
  }

  input.plungerPrev = plungerPressed;
  input.nudgePrev = nudgePressed;
}

function stepSimulationFrame() {
  handleInputEdges();

  if (state.screen !== "playing") {
    return;
  }

  if (input.plunger && table.balls.some((ball) => ball.inPlunger)) {
    state.launchCharge = clamp(state.launchCharge + FIXED_STEP * 0.65, 0, 1);
  } else if (!input.plunger) {
    state.launchCharge = Math.max(0, state.launchCharge - FIXED_STEP * 0.6);
  }

  state.messageTimer = Math.max(0, state.messageTimer - FIXED_STEP);
  state.nudgeCooldown = Math.max(0, state.nudgeCooldown - FIXED_STEP);

  if (state.mode === "overdrive") {
    state.modeTimer -= FIXED_STEP;
    if (state.modeTimer <= 0) {
      resetMode();
      setMessage("OVERDRIVE ENDED", 1.2);
    }
  }

  if (table.dropResetTimer > 0) {
    table.dropResetTimer -= FIXED_STEP;
    if (table.dropResetTimer <= 0) {
      resetDropTargets();
    }
  }

  if (table.drainingBall) {
    table.drainTimer -= FIXED_STEP;
    if (table.drainTimer <= 0) {
      destroyBall(table.drainingBall);
      advanceBall();
    }
  }

  if (state.serveTimer > 0) {
    state.serveTimer -= FIXED_STEP;
    if (state.serveTimer <= 0) {
      serveBall();
    }
  }

  updateFlipper(table.flippers[0], input.left, FIXED_STEP);
  updateFlipper(table.flippers[1], input.right, FIXED_STEP);

  for (let i = 0; i < SUBSTEPS; i += 1) {
    world.step(SUBSTEP_DT, VELOCITY_ITERS, POSITION_ITERS);
    for (const ball of table.balls) {
      capBallSpeed(ball);
      ball.flash = Math.max(0, ball.flash - SUBSTEP_DT);
    }
  }

  for (const bumper of table.bumpers) {
    bumper.flash = Math.max(0, bumper.flash - FIXED_STEP);
  }
  for (const sling of table.slingshots) {
    sling.flash = Math.max(0, sling.flash - FIXED_STEP);
  }
  for (const target of table.dropTargets) {
    target.flash = Math.max(0, target.flash - FIXED_STEP);
  }
}

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTableArt() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#081120");
  bg.addColorStop(0.45, "#101728");
  bg.addColorStop(1, "#05070b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (table) {
    for (const star of table.stars) {
      ctx.globalAlpha = star.a;
      ctx.fillStyle = "#fff";
      ctx.fillRect(star.x, star.y, star.r, star.r);
    }
    ctx.globalAlpha = 1;
  }

  const frame = {
    x: OFFSET_X - 20,
    y: OFFSET_Y - 18,
    w: WORLD_W * SCALE + 40,
    h: WORLD_H * SCALE + 36,
  };
  const playfield = ctx.createLinearGradient(frame.x, frame.y, frame.x, frame.y + frame.h);
  playfield.addColorStop(0, "#16304e");
  playfield.addColorStop(0.52, "#0f2239");
  playfield.addColorStop(1, "#091420");
  drawRoundedRect(frame.x, frame.y, frame.w, frame.h, 26);
  ctx.fillStyle = playfield;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  drawRoundedRect(frame.x + 10, frame.y + 10, frame.w - 20, frame.h - 20, 22);
  ctx.clip();

  const glow = ctx.createRadialGradient(canvas.width / 2, OFFSET_Y + 180, 40, canvas.width / 2, OFFSET_Y + 180, 520);
  glow.addColorStop(0, "rgba(109,229,255,0.18)");
  glow.addColorStop(0.5, "rgba(109,229,255,0.06)");
  glow.addColorStop(1, "rgba(109,229,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(frame.x, frame.y, frame.w, frame.h);

  ctx.strokeStyle = "rgba(232,237,244,0.18)";
  ctx.lineWidth = 3;
  const guides = [
    [1.0, 1.0, 1.0, 18.9],
    [1.0, 1.0, 8.1, 1.0],
    [8.1, 1.0, 8.45, 2.95],
    [8.45, 2.95, 8.45, 19.05],
    [9.75, 1.0, 9.75, 19.05],
    [2.05, 18.9, 2.05, 15.4],
    [7.95, 18.9, 7.95, 15.4],
    [1.55, 3.3, 1.55, 14.6],
    [2.25, 3.0, 2.25, 14.1],
    [8.95, 4.6, 8.95, 14.45],
  ];
  for (const [ax, ay, bx, by] of guides) {
    const a = toScreen(Vec2(ax, ay));
    const b = toScreen(Vec2(bx, by));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,177,0,0.09)";
  for (const [x, y, w, h] of [
    [OFFSET_X + 20, OFFSET_Y + 120, 90, 770],
    [OFFSET_X + WORLD_W * SCALE - 120, OFFSET_Y + 200, 80, 730],
  ]) {
    drawRoundedRect(x, y, w, h, 18);
    ctx.fill();
  }

  const title = ctx.createLinearGradient(canvas.width / 2 - 180, OFFSET_Y + 40, canvas.width / 2 + 180, OFFSET_Y + 40);
  title.addColorStop(0, "#6de5ff");
  title.addColorStop(1, "#ffb100");
  ctx.fillStyle = title;
  ctx.font = "bold 52px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PINBALL 5.5", canvas.width / 2, OFFSET_Y + 70);
  ctx.font = "20px Trebuchet MS, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("ORBIT RUN", canvas.width / 2, OFFSET_Y + 100);
  ctx.textAlign = "start";

  ctx.restore();
}

function drawBumper(bumper) {
  const p = toScreen(bumper.body.getPosition());
  const glow = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 52);
  glow.addColorStop(0, `rgba(255,95,144,${0.65 + bumper.flash * 2})`);
  glow.addColorStop(1, "rgba(255,95,144,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 52, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = bumper.flash > 0 ? "#fff0af" : "#ff5f90";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#f8f4fb";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawDropTarget(target) {
  if (target.down) {
    return;
  }
  const p = toScreen(target.body.getPosition());
  ctx.fillStyle = target.flash > 0 ? "#fff0af" : "#6de5ff";
  ctx.fillRect(p.x - 12, p.y - 32, 24, 64);
  ctx.strokeStyle = "#f7fbff";
  ctx.lineWidth = 2;
  ctx.strokeRect(p.x - 12, p.y - 32, 24, 64);
}

function drawSlingshot(sling) {
  ctx.fillStyle = sling.flash > 0 ? "#fff0af" : "#ffb100";
  ctx.strokeStyle = "#fff6df";
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (sling.side === "left") {
    const a = toScreen(Vec2(2.55, 14.85));
    const b = toScreen(Vec2(3.9, 14.6));
    const c = toScreen(Vec2(3.15, 16.0));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
  } else {
    const a = toScreen(Vec2(7.45, 14.85));
    const b = toScreen(Vec2(6.1, 14.6));
    const c = toScreen(Vec2(6.85, 16.0));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawFlipper(flipper) {
  const pivot = flipper.body.getPosition();
  const angle = flipper.body.getAngle();
  ctx.save();
  const p = toScreen(pivot);
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.scale(flipper.dir, 1);

  ctx.fillStyle = flipper.flash > 0 ? "#ffe29f" : "#ffb100";
  ctx.strokeStyle = "#fff3d9";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(8, -15);
  ctx.lineTo(95, -15);
  ctx.arc(95, 0, 15, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(8, 15);
  ctx.arc(8, 0, 19, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#c97300";
  ctx.fill();
  ctx.restore();
}

function drawBall(ball) {
  const pos = toScreen(ball.body.getPosition());
  const radius = BALL_RADIUS * SCALE;
  const gradient = ctx.createRadialGradient(pos.x - 5, pos.y - 5, 2, pos.x, pos.y, radius + 4);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.4, "#dbe5ef");
  gradient.addColorStop(1, "#8ea1b2");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHud() {
  ctx.fillStyle = "#eef4fa";
  ctx.font = "bold 22px Trebuchet MS, sans-serif";
  ctx.fillText(`SCORE ${state.score.toString().padStart(7, "0")}`, 48, 32);
  ctx.fillText(`HIGH ${state.highScore.toString().padStart(7, "0")}`, 340, 32);
  ctx.fillText(`BALL ${state.ballNumber}/${TOTAL_BALLS}`, 720, 32);

  ctx.font = "18px Trebuchet MS, sans-serif";
  if (state.mode === "overdrive") {
    ctx.fillStyle = "#fff1a8";
    ctx.fillText(`MODE OVERDRIVE  ${state.modeTimer.toFixed(1)}s`, 48, 62);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.fillText("MODE STANDARD", 48, 62);
  }

  if (state.messageTimer > 0) {
    ctx.fillStyle = "#6de5ff";
    ctx.textAlign = "center";
    ctx.font = "bold 26px Trebuchet MS, sans-serif";
    ctx.fillText(state.messageText, canvas.width / 2, 86);
    ctx.textAlign = "start";
  }

  const barX = OFFSET_X + WORLD_W * SCALE - 85;
  const barY = OFFSET_Y + 1060;
  const barH = 190;
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, barY, 34, barH);
  ctx.fillStyle = "#ffb100";
  ctx.fillRect(barX + 3, barY + barH - state.launchCharge * (barH - 6) - 3, 28, state.launchCharge * (barH - 6));
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.font = "16px Trebuchet MS, sans-serif";
  ctx.fillText("PLUNGER", barX - 26, barY - 12);
}

function drawOverlay(lines, sublines = []) {
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f5fbff";
  ctx.font = "bold 60px Trebuchet MS, sans-serif";
  ctx.fillText(lines[0], canvas.width / 2, 420);
  ctx.font = "22px Trebuchet MS, sans-serif";
  for (let i = 1; i < lines.length; i += 1) {
    ctx.fillText(lines[i], canvas.width / 2, 470 + (i - 1) * 34);
  }
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  for (let i = 0; i < sublines.length; i += 1) {
    ctx.fillText(sublines[i], canvas.width / 2, 640 + i * 30);
  }
  ctx.textAlign = "start";
}

function render() {
  drawTableArt();

  if (table) {
    for (const sling of table.slingshots) {
      drawSlingshot(sling);
    }
    for (const bumper of table.bumpers) {
      drawBumper(bumper);
    }
    for (const target of table.dropTargets) {
      drawDropTarget(target);
    }
    for (const flipper of table.flippers) {
      drawFlipper(flipper);
    }
    for (const ball of table.balls) {
      drawBall(ball);
    }
  }

  drawHud();

  if (state.screen === "title") {
    drawOverlay(
      ["PINBALL 5.5", "A single-static-site pinball table"],
      [
        "LEFT / Z and RIGHT / / control the flippers",
        "DOWN or SPACE charges the plunger",
        "SHIFT nudges the table",
        "Complete the drop bank to start 15 seconds of 2x scoring",
        "PRESS ENTER TO START",
      ],
    );
  } else if (state.screen === "gameover") {
    drawOverlay(
      ["GAME OVER", `FINAL SCORE ${state.score.toString().padStart(7, "0")}`],
      ["PRESS ENTER TO RESTART"],
    );
  }
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += dt;

  while (accumulator >= FIXED_STEP) {
    stepSimulationFrame();
    accumulator -= FIXED_STEP;
  }

  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowDown", "Space", "ShiftLeft", "ShiftRight", "Enter", "KeyZ", "Slash"].includes(event.code)) {
    event.preventDefault();
  }
  maybeInitAudio();
  if (event.repeat) {
    return;
  }
  keys.add(event.code);

  if (event.code === "Enter" && (state.screen === "title" || state.screen === "gameover")) {
    startGame();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

buildTable();
resetDropTargets();
render();
requestAnimationFrame(loop);
