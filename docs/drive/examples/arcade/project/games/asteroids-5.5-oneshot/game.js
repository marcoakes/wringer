const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const TAU = Math.PI * 2;
const KEYS = new Set();

const ASTEROID_RADII = { large: 48, medium: 26, small: 14 };
const ASTEROID_SPEED = { large: 44, medium: 68, small: 96 };
const ASTEROID_SCORE = { large: 20, medium: 50, small: 100 };
const UFO_SCORE = { large: 200, small: 1000 };
const STAR_COUNT = 120;
const STARTING_ASTEROIDS = 4;

const stars = Array.from({ length: STAR_COUNT }, () => ({
  x: Math.random() * WIDTH,
  y: Math.random() * HEIGHT,
  r: Math.random() * 1.7 + 0.3,
  a: Math.random() * 0.5 + 0.25,
}));

let audioCtx = null;

function playTone(freq, duration, type = "square", volume = 0.04) {
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

function maybeInitAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function wrapPosition(obj) {
  if (obj.x < 0) obj.x += WIDTH;
  if (obj.x >= WIDTH) obj.x -= WIDTH;
  if (obj.y < 0) obj.y += HEIGHT;
  if (obj.y >= HEIGHT) obj.y -= HEIGHT;
}

function distanceSquared(a, b) {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (dx > WIDTH / 2) dx = WIDTH - dx;
  if (dy > HEIGHT / 2) dy = HEIGHT - dy;
  return dx * dx + dy * dy;
}

function createShip() {
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    radius: 12,
    cooldown: 0,
    alive: true,
    thrusting: false,
    respawnTimer: 0,
    invulnerable: 0,
  };
}

function createAsteroid(x, y, size, fromSplit = false) {
  const radius = ASTEROID_RADII[size];
  const speed = ASTEROID_SPEED[size];
  const angle = Math.random() * TAU;
  const jag = 10 + Math.floor(Math.random() * 5);
  const points = [];
  for (let i = 0; i < jag; i += 1) {
    const t = (i / jag) * TAU;
    const offset = rand(0.7, 1.3);
    points.push({ angle: t, radius: radius * offset });
  }
  return {
    kind: "asteroid",
    x,
    y,
    vx: Math.cos(angle) * speed + (fromSplit ? rand(-20, 20) : 0),
    vy: Math.sin(angle) * speed + (fromSplit ? rand(-20, 20) : 0),
    radius,
    size,
    points,
    spin: rand(-0.9, 0.9),
    angle: Math.random() * TAU,
  };
}

function createBullet(x, y, angle, speed, ttl, owner) {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: owner === "ship" ? 2 : 3,
    ttl,
    owner,
  };
}

function createParticle(x, y, vx, vy, ttl) {
  return { x, y, vx, vy, ttl, maxTtl: ttl };
}

function createUfo(size) {
  const fromLeft = Math.random() < 0.5;
  const y = rand(90, HEIGHT - 90);
  const dir = fromLeft ? 1 : -1;
  return {
    kind: "ufo",
    size,
    x: fromLeft ? -60 : WIDTH + 60,
    y,
    vx: dir * (size === "large" ? 90 : 130),
    vy: rand(-32, 32),
    radius: size === "large" ? 24 : 16,
    fireTimer: size === "large" ? 1.3 : 0.9,
    zigTimer: rand(0.8, 1.6),
  };
}

const state = {
  screen: "title",
  score: 0,
  highScore: 0,
  lives: 3,
  wave: 1,
  nextExtraLife: 10000,
  ship: createShip(),
  bullets: [],
  enemyBullets: [],
  asteroids: [],
  particles: [],
  ufo: null,
  ufoSpawnTimer: rand(10, 16),
  waveClearTimer: 0,
  respawnDelay: 0,
};

function resetGame() {
  state.screen = "playing";
  state.score = 0;
  state.lives = 3;
  state.wave = 1;
  state.nextExtraLife = 10000;
  state.ship = createShip();
  state.bullets = [];
  state.enemyBullets = [];
  state.asteroids = [];
  state.particles = [];
  state.ufo = null;
  state.ufoSpawnTimer = rand(8, 14);
  state.waveClearTimer = 0;
  state.respawnDelay = 0;
  startWave();
}

function startWave() {
  state.bullets.length = 0;
  state.enemyBullets.length = 0;
  state.asteroids = [];
  state.ufo = null;
  state.ufoSpawnTimer = rand(7, 13);
  const count = STARTING_ASTEROIDS + (state.wave - 1);
  for (let i = 0; i < count; i += 1) {
    let x;
    let y;
    do {
      x = Math.random() * WIDTH;
      y = Math.random() * HEIGHT;
    } while ((x - WIDTH / 2) ** 2 + (y - HEIGHT / 2) ** 2 < 180 ** 2);
    state.asteroids.push(createAsteroid(x, y, "large"));
  }
  state.ship = createShip();
  state.ship.invulnerable = 2;
}

function addScore(points) {
  state.score += points;
  if (state.score > state.highScore) {
    state.highScore = state.score;
  }
  while (state.score >= state.nextExtraLife) {
    state.lives += 1;
    state.nextExtraLife += 10000;
    playTone(880, 0.18, "triangle", 0.05);
  }
}

function spawnAsteroidChildren(asteroid) {
  if (asteroid.size === "small") {
    return;
  }
  const nextSize = asteroid.size === "large" ? "medium" : "small";
  for (let i = 0; i < 2; i += 1) {
    state.asteroids.push(createAsteroid(asteroid.x, asteroid.y, nextSize, true));
  }
}

function explodeAt(x, y, count, speedBase) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * TAU;
    const speed = rand(speedBase * 0.4, speedBase);
    state.particles.push(
      createParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, rand(0.35, 0.8)),
    );
  }
}

function destroyShip() {
  explodeAt(state.ship.x, state.ship.y, 18, 180);
  playTone(120, 0.35, "sawtooth", 0.06);
  state.lives -= 1;
  state.ship.alive = false;
  state.respawnDelay = 1.6;
  state.bullets.length = 0;
  if (state.lives <= 0) {
    state.screen = "gameover";
  }
}

function tryRespawn() {
  const safe = state.asteroids.every(
    (asteroid) => distanceSquared(asteroid, { x: WIDTH / 2, y: HEIGHT / 2 }) > 160 ** 2,
  ) && (!state.ufo || distanceSquared(state.ufo, { x: WIDTH / 2, y: HEIGHT / 2 }) > 180 ** 2);
  if (safe) {
    state.ship = createShip();
    state.ship.invulnerable = 2.5;
  }
}

function fireShipBullet() {
  const ship = state.ship;
  if (!ship.alive || ship.cooldown > 0 || state.bullets.length >= 4) {
    return;
  }
  const speed = 430;
  const noseX = ship.x + Math.cos(ship.angle) * 16;
  const noseY = ship.y + Math.sin(ship.angle) * 16;
  const bullet = createBullet(noseX, noseY, ship.angle, speed, 1.15, "ship");
  bullet.vx += ship.vx;
  bullet.vy += ship.vy;
  state.bullets.push(bullet);
  ship.cooldown = 0.18;
  playTone(620, 0.05, "square", 0.04);
}

function useHyperspace() {
  if (!state.ship.alive) {
    return;
  }
  state.ship.x = Math.random() * WIDTH;
  state.ship.y = Math.random() * HEIGHT;
  state.ship.vx *= 0.5;
  state.ship.vy *= 0.5;
  state.ship.invulnerable = 1.1;
  playTone(280, 0.12, "triangle", 0.05);
  if (Math.random() < 0.08) {
    destroyShip();
  }
}

function fireUfoBullet() {
  if (!state.ufo) {
    return;
  }
  const ufo = state.ufo;
  let angle;
  if (ufo.size === "small" && state.ship.alive) {
    angle = Math.atan2(state.ship.y - ufo.y, state.ship.x - ufo.x);
    angle += rand(-0.08, 0.08);
  } else {
    angle = Math.random() * TAU;
  }
  const bullet = createBullet(ufo.x, ufo.y, angle, 260, 2.2, "ufo");
  state.enemyBullets.push(bullet);
  playTone(ufo.size === "small" ? 420 : 250, 0.07, "square", 0.035);
}

function updateShip(dt) {
  const ship = state.ship;
  if (!ship.alive) {
    return;
  }
  const rotateSpeed = 4.1;
  const thrust = 190;
  ship.thrusting = false;

  if (KEYS.has("ArrowLeft")) ship.angle -= rotateSpeed * dt;
  if (KEYS.has("ArrowRight")) ship.angle += rotateSpeed * dt;
  if (KEYS.has("ArrowUp")) {
    ship.vx += Math.cos(ship.angle) * thrust * dt;
    ship.vy += Math.sin(ship.angle) * thrust * dt;
    ship.thrusting = true;
    if (Math.random() < 0.2) {
      state.particles.push(
        createParticle(
          ship.x - Math.cos(ship.angle) * 12,
          ship.y - Math.sin(ship.angle) * 12,
          -Math.cos(ship.angle) * rand(80, 140) + rand(-20, 20),
          -Math.sin(ship.angle) * rand(80, 140) + rand(-20, 20),
          rand(0.15, 0.3),
        ),
      );
    }
  }

  const drag = 0.994;
  ship.vx *= drag;
  ship.vy *= drag;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  wrapPosition(ship);

  ship.cooldown = Math.max(0, ship.cooldown - dt);
  ship.invulnerable = Math.max(0, ship.invulnerable - dt);
}

function updateBodies(list, dt) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const body = list[i];
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    wrapPosition(body);
    if ("ttl" in body) {
      body.ttl -= dt;
      if (body.ttl <= 0) {
        list.splice(i, 1);
      }
    }
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    wrapPosition(p);
    p.ttl -= dt;
    if (p.ttl <= 0) {
      state.particles.splice(i, 1);
    }
  }
}

function updateAsteroids(dt) {
  for (const asteroid of state.asteroids) {
    asteroid.x += asteroid.vx * dt;
    asteroid.y += asteroid.vy * dt;
    asteroid.angle += asteroid.spin * dt;
    wrapPosition(asteroid);
  }
}

function updateUfo(dt) {
  if (!state.ufo) {
    state.ufoSpawnTimer -= dt;
    if (state.ufoSpawnTimer <= 0 && state.screen === "playing" && state.asteroids.length > 0) {
      state.ufo = createUfo(Math.random() < Math.min(0.8, 0.35 + state.wave * 0.07) ? "small" : "large");
      playTone(state.ufo.size === "small" ? 330 : 210, 0.2, "sawtooth", 0.03);
    }
    return;
  }

  const ufo = state.ufo;
  ufo.x += ufo.vx * dt;
  ufo.y += ufo.vy * dt;
  ufo.zigTimer -= dt;
  if (ufo.zigTimer <= 0) {
    ufo.vy = rand(-60, 60);
    ufo.zigTimer = rand(0.7, 1.4);
  }
  if (ufo.y < 60 || ufo.y > HEIGHT - 60) {
    ufo.vy *= -1;
  }

  ufo.fireTimer -= dt;
  if (ufo.fireTimer <= 0) {
    fireUfoBullet();
    ufo.fireTimer = ufo.size === "small" ? rand(0.75, 1.1) : rand(1.2, 1.8);
  }

  if (ufo.x < -90 || ufo.x > WIDTH + 90) {
    state.ufo = null;
    state.ufoSpawnTimer = rand(8, 15);
  }
}

function handleBulletHits() {
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    let hit = false;

    for (let j = state.asteroids.length - 1; j >= 0; j -= 1) {
      const asteroid = state.asteroids[j];
      if (distanceSquared(bullet, asteroid) <= (asteroid.radius + bullet.radius) ** 2) {
        state.bullets.splice(i, 1);
        state.asteroids.splice(j, 1);
        addScore(ASTEROID_SCORE[asteroid.size]);
        spawnAsteroidChildren(asteroid);
        explodeAt(asteroid.x, asteroid.y, asteroid.size === "large" ? 10 : 7, 130);
        playTone(asteroid.size === "large" ? 180 : asteroid.size === "medium" ? 240 : 340, 0.08, "triangle", 0.05);
        hit = true;
        break;
      }
    }

    if (hit) {
      continue;
    }

    if (state.ufo && distanceSquared(bullet, state.ufo) <= (state.ufo.radius + bullet.radius) ** 2) {
      addScore(UFO_SCORE[state.ufo.size]);
      explodeAt(state.ufo.x, state.ufo.y, 12, 170);
      playTone(140, 0.22, "sawtooth", 0.05);
      state.ufo = null;
      state.ufoSpawnTimer = rand(10, 16);
      state.bullets.splice(i, 1);
    }
  }
}

function handleShipCollisions() {
  if (!state.ship.alive || state.ship.invulnerable > 0) {
    return;
  }
  for (const asteroid of state.asteroids) {
    if (distanceSquared(state.ship, asteroid) <= (state.ship.radius + asteroid.radius - 2) ** 2) {
      destroyShip();
      return;
    }
  }
  if (state.ufo && distanceSquared(state.ship, state.ufo) <= (state.ship.radius + state.ufo.radius) ** 2) {
    destroyShip();
    return;
  }
  for (let i = state.enemyBullets.length - 1; i >= 0; i -= 1) {
    if (distanceSquared(state.ship, state.enemyBullets[i]) <= (state.ship.radius + 3) ** 2) {
      state.enemyBullets.splice(i, 1);
      destroyShip();
      return;
    }
  }
}

function handleUfoAsteroidCollisions() {
  if (!state.ufo) {
    return;
  }
  for (const asteroid of state.asteroids) {
    if (distanceSquared(state.ufo, asteroid) <= (state.ufo.radius + asteroid.radius) ** 2) {
      explodeAt(state.ufo.x, state.ufo.y, 10, 140);
      state.ufo = null;
      state.ufoSpawnTimer = rand(9, 15);
      return;
    }
  }
}

function updateGame(dt) {
  if (state.screen !== "playing") {
    return;
  }

  updateShip(dt);
  updateBodies(state.bullets, dt);
  updateBodies(state.enemyBullets, dt);
  updateAsteroids(dt);
  updateParticles(dt);
  updateUfo(dt);
  handleBulletHits();
  handleShipCollisions();
  handleUfoAsteroidCollisions();

  if (!state.ship.alive && state.screen === "playing") {
    state.respawnDelay -= dt;
    if (state.respawnDelay <= 0) {
      if (state.lives > 0) {
        tryRespawn();
      }
    }
  }

  if (state.asteroids.length === 0 && !state.waveClearTimer) {
    state.waveClearTimer = 1.2;
  }
  if (state.waveClearTimer > 0) {
    state.waveClearTimer -= dt;
    if (state.waveClearTimer <= 0) {
      state.wave += 1;
      startWave();
      state.waveClearTimer = 0;
    }
  }
}

function drawWrapped(drawFn, x, y, radius) {
  const offsets = [];
  if (x < radius) offsets.push([WIDTH, 0]);
  if (x > WIDTH - radius) offsets.push([-WIDTH, 0]);
  if (y < radius) offsets.push([0, HEIGHT]);
  if (y > HEIGHT - radius) offsets.push([0, -HEIGHT]);
  drawFn(x, y);
  for (const [ox, oy] of offsets) {
    drawFn(x + ox, y + oy);
  }
  if (offsets.length === 2) {
    drawFn(x + offsets[0][0] + offsets[1][0], y + offsets[0][1] + offsets[1][1]);
  }
}

function drawShip(ship) {
  const alpha = ship.invulnerable > 0 && Math.floor(ship.invulnerable * 10) % 2 === 0 ? 0.3 : 1;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle + Math.PI / 2);
  ctx.strokeStyle = `rgba(242,242,242,${alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(9, 12);
  ctx.lineTo(0, 7);
  ctx.lineTo(-9, 12);
  ctx.closePath();
  ctx.stroke();
  if (ship.thrusting) {
    ctx.beginPath();
    ctx.moveTo(-4, 11);
    ctx.lineTo(0, 20 + Math.random() * 6);
    ctx.lineTo(4, 11);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAsteroid(asteroid) {
  ctx.save();
  ctx.translate(asteroid.x, asteroid.y);
  ctx.rotate(asteroid.angle);
  ctx.strokeStyle = "#f2f2f2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  asteroid.points.forEach((point, index) => {
    const px = Math.cos(point.angle) * point.radius;
    const py = Math.sin(point.angle) * point.radius;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawBullet(bullet) {
  ctx.fillStyle = "#f2f2f2";
  ctx.beginPath();
  ctx.arc(bullet.x, bullet.y, bullet.radius, 0, TAU);
  ctx.fill();
}

function drawUfo(ufo) {
  ctx.save();
  ctx.translate(ufo.x, ufo.y);
  ctx.strokeStyle = "#f2f2f2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-ufo.radius, 2);
  ctx.lineTo(-ufo.radius / 2, -ufo.radius / 2);
  ctx.lineTo(ufo.radius / 2, -ufo.radius / 2);
  ctx.lineTo(ufo.radius, 2);
  ctx.lineTo(ufo.radius / 2, ufo.radius / 2);
  ctx.lineTo(-ufo.radius / 2, ufo.radius / 2);
  ctx.closePath();
  ctx.moveTo(-ufo.radius / 3, -ufo.radius / 2);
  ctx.lineTo(0, -ufo.radius * 0.95);
  ctx.lineTo(ufo.radius / 3, -ufo.radius / 2);
  ctx.stroke();
  ctx.restore();
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.ttl / p.maxTtl);
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(p.x, p.y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawLives() {
  for (let i = 0; i < Math.max(0, state.lives); i += 1) {
    ctx.save();
    ctx.translate(28 + i * 22, 52);
    ctx.scale(0.8, 0.8);
    ctx.strokeStyle = "#f2f2f2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud() {
  ctx.fillStyle = "#f2f2f2";
  ctx.font = "24px Trebuchet MS, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`SCORE ${state.score.toString().padStart(5, "0")}`, 22, 18);
  ctx.fillText(`HIGH ${state.highScore.toString().padStart(5, "0")}`, 350, 18);
  ctx.fillText(`WAVE ${state.wave}`, 760, 18);
  drawLives();
}

function drawCenteredText(lines, y, size = 36, color = "#f2f2f2") {
  ctx.fillStyle = color;
  ctx.font = `${size}px Trebuchet MS, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], WIDTH / 2, y + i * (size + 12));
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawTitleScreen() {
  drawCenteredText(["ASTEROIDS"], 170, 68);
  drawCenteredText(["A scratch-built arcade clone", "for a single static GitHub Pages site"], 270, 24, "#bbbbbb");
  drawCenteredText(["LEFT / RIGHT  ROTATE", "UP  THRUST", "SPACE  FIRE", "SHIFT or H  HYPERSPACE"], 390, 28);
  drawCenteredText(["PRESS ENTER TO START"], 610, 28);
}

function drawGameOver() {
  drawCenteredText(["GAME OVER"], 300, 54);
  drawCenteredText([`FINAL SCORE ${state.score}`, "PRESS ENTER TO RESTART"], 400, 28);
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  for (const star of stars) {
    ctx.globalAlpha = star.a;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(star.x, star.y, star.r, star.r);
  }
  ctx.globalAlpha = 1;

  if (state.screen === "title") {
    drawTitleScreen();
    return;
  }

  drawHud();
  drawParticles();

  for (const asteroid of state.asteroids) {
    drawWrapped((x, y) => {
      const originalX = asteroid.x;
      const originalY = asteroid.y;
      asteroid.x = x;
      asteroid.y = y;
      drawAsteroid(asteroid);
      asteroid.x = originalX;
      asteroid.y = originalY;
    }, asteroid.x, asteroid.y, asteroid.radius + 4);
  }

  for (const bullet of state.bullets) {
    drawWrapped(drawBullet, bullet.x, bullet.y, 4);
  }
  for (const bullet of state.enemyBullets) {
    drawWrapped(drawBullet, bullet.x, bullet.y, 5);
  }

  if (state.ufo) {
    drawWrapped((x, y) => {
      const originalX = state.ufo.x;
      const originalY = state.ufo.y;
      state.ufo.x = x;
      state.ufo.y = y;
      drawUfo(state.ufo);
      state.ufo.x = originalX;
      state.ufo.y = originalY;
    }, state.ufo.x, state.ufo.y, state.ufo.radius + 4);
  }

  if (state.ship.alive) {
    drawWrapped((x, y) => {
      const originalX = state.ship.x;
      const originalY = state.ship.y;
      state.ship.x = x;
      state.ship.y = y;
      drawShip(state.ship);
      state.ship.x = originalX;
      state.ship.y = originalY;
    }, state.ship.x, state.ship.y, state.ship.radius + 10);
  }

  if (state.waveClearTimer > 0) {
    drawCenteredText(["SECTOR CLEAR"], 320, 34);
  }

  if (state.screen === "gameover") {
    drawGameOver();
  }
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "ShiftLeft", "ShiftRight", "KeyH", "Enter"].includes(event.code)) {
    event.preventDefault();
  }
  maybeInitAudio();
  if (event.repeat) {
    return;
  }
  KEYS.add(event.key);
  KEYS.add(event.code);

  if (event.code === "Space" && state.screen === "playing") {
    fireShipBullet();
  } else if ((event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyH") && state.screen === "playing") {
    useHyperspace();
  } else if (event.code === "Enter" && (state.screen === "title" || state.screen === "gameover")) {
    resetGame();
  }
});

window.addEventListener("keyup", (event) => {
  KEYS.delete(event.key);
  KEYS.delete(event.code);
});

let lastTime = performance.now();

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  updateGame(dt);
  render();
  requestAnimationFrame(frame);
}

render();
requestAnimationFrame(frame);
