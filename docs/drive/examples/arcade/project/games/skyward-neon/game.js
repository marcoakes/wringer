const PLAYER_SPEED = 270;
const JUMP_VELOCITY = -620;
const COYOTE_TIME_MS = 120;
const JUMP_BUFFER_MS = 140;

const LEVELS = [
    {
        name: 'Level 1: Launch Grid',
        width: 3600,
        groundY: 600,
        start: { x: 96, y: 460 },
        ground: [
            { x: 0, width: 960 },
            { x: 1120, width: 820 },
            { x: 2090, width: 700 },
            { x: 2960, width: 640 }
        ],
        platforms: [
            { x: 510, y: 486, width: 360 },
            { x: 1180, y: 430, width: 300 },
            { x: 1620, y: 340, width: 300 },
            { x: 2260, y: 472, width: 340 },
            { x: 2860, y: 394, width: 300 }
        ],
        spikes: [
            { x: 690, y: 600, count: 3 },
            { x: 1320, y: 430, count: 2 },
            { x: 2350, y: 472, count: 3 },
            { x: 3160, y: 600, count: 4 }
        ],
        lasers: [
            { x: 1780, surfaceY: 600, height: 92, pulse: 1200, offset: 0 },
            { x: 3060, surfaceY: 600, height: 104, pulse: 1450, offset: 350 }
        ],
        drones: [
            { x: 2160, y: 520, minX: 2090, maxX: 2720, speed: 80 }
        ],
        finish: { x: 3450, y: 600 }
    },
    {
        name: 'Level 2: Relay Spires',
        width: 4100,
        groundY: 610,
        start: { x: 90, y: 470 },
        ground: [
            { x: 0, width: 620 },
            { x: 790, width: 700 },
            { x: 1660, width: 690 },
            { x: 2520, width: 740 },
            { x: 3420, width: 680 }
        ],
        platforms: [
            { x: 420, y: 488, width: 300 },
            { x: 880, y: 410, width: 300 },
            { x: 1300, y: 314, width: 280 },
            { x: 1760, y: 470, width: 340 },
            { x: 2200, y: 360, width: 300 },
            { x: 2650, y: 286, width: 280 },
            { x: 3060, y: 430, width: 320 },
            { x: 3580, y: 500, width: 340 }
        ],
        spikes: [
            { x: 500, y: 488, count: 2 },
            { x: 960, y: 410, count: 3 },
            { x: 1770, y: 610, count: 5 },
            { x: 2710, y: 286, count: 2 },
            { x: 3620, y: 500, count: 3 }
        ],
        lasers: [
            { x: 1240, surfaceY: 610, height: 118, pulse: 1150, offset: 240 },
            { x: 2350, surfaceY: 610, height: 112, pulse: 1300, offset: 620 },
            { x: 3260, surfaceY: 430, height: 86, pulse: 1000, offset: 120 }
        ],
        drones: [
            { x: 820, y: 520, minX: 790, maxX: 1360, speed: 92 },
            { x: 2240, y: 438, minX: 2160, maxX: 2960, speed: -105 }
        ],
        finish: { x: 3940, y: 610 }
    },
    {
        name: 'Level 3: Aurora Gauntlet',
        width: 4700,
        groundY: 620,
        start: { x: 90, y: 480 },
        ground: [
            { x: 0, width: 760 },
            { x: 940, width: 690 },
            { x: 1790, width: 670 },
            { x: 2620, width: 710 },
            { x: 3500, width: 1200 }
        ],
        platforms: [
            { x: 430, y: 494, width: 300 },
            { x: 900, y: 400, width: 280 },
            { x: 1320, y: 304, width: 280 },
            { x: 1850, y: 472, width: 320 },
            { x: 2260, y: 358, width: 290 },
            { x: 2690, y: 270, width: 280 },
            { x: 3120, y: 410, width: 300 },
            { x: 3600, y: 510, width: 330 },
            { x: 4040, y: 392, width: 300 }
        ],
        spikes: [
            { x: 310, y: 620, count: 4 },
            { x: 980, y: 400, count: 3 },
            { x: 1940, y: 472, count: 3 },
            { x: 2760, y: 270, count: 2 },
            { x: 3690, y: 510, count: 3 },
            { x: 4210, y: 620, count: 5 }
        ],
        lasers: [
            { x: 1200, surfaceY: 620, height: 126, pulse: 900, offset: 100 },
            { x: 2470, surfaceY: 620, height: 132, pulse: 950, offset: 500 },
            { x: 3300, surfaceY: 620, height: 132, pulse: 1100, offset: 220 },
            { x: 4110, surfaceY: 392, height: 90, pulse: 850, offset: 430 }
        ],
        drones: [
            { x: 990, y: 515, minX: 940, maxX: 1470, speed: 112 },
            { x: 1910, y: 548, minX: 1790, maxX: 2290, speed: -96 },
            { x: 3530, y: 542, minX: 3500, maxX: 4620, speed: 132 }
        ],
        finish: { x: 4560, y: 620 }
    }
];

class SkywardScene extends Phaser.Scene {
    constructor() {
        super({ key: 'SkywardScene' });
        this.bestTime = Number(localStorage.getItem('skyward-neon-best') || 0);
    }

    preload() {
        this.load.spritesheet('player', 'https://labs.phaser.io/assets/sprites/dude.png', {
            frameWidth: 32,
            frameHeight: 48
        });
    }

    create() {
        this.worldHeight = 760;
        this.levelIndex = 0;
        this.deaths = 0;
        this.runStartTime = this.time.now;
        this.isTransitioning = false;
        this.isInvulnerable = false;
        this.hasWon = false;
        this.touchState = { left: false, right: false, jump: false };
        this.touchJumpWasDown = false;
        this.lastGroundedAt = 0;
        this.jumpQueuedAt = -Infinity;
        this.levelColliders = [];

        this.createTextures();
        this.createBackground();
        this.createPlayer();
        this.createEffects();
        this.createUi();
        this.createInput();
        this.loadLevel(0);

        this.cameras.main.startFollow(this.player, true, 0.1, 0.055);
        this.cameras.main.setZoom(1.15);
    }

    createTextures() {
        const graphics = this.add.graphics();

        graphics.fillStyle(0x0b0c18, 1);
        graphics.fillRoundedRect(0, 0, 400, 24, 4);
        graphics.fillStyle(0x00e5ff, 1);
        graphics.fillRect(0, 0, 400, 4);
        graphics.fillStyle(0xff3fb4, 0.9);
        graphics.fillRect(0, 20, 400, 2);
        graphics.lineStyle(1, 0x8dff65, 0.55);
        for (let x = 28; x < 400; x += 56) {
            graphics.lineBetween(x, 6, x + 20, 19);
        }
        graphics.generateTexture('ground', 400, 24);
        graphics.clear();

        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(4, 4, 4);
        graphics.generateTexture('particle', 8, 8);
        graphics.clear();

        this.createStarTexture(graphics, 'stars-far', 512, 320, 70, 0.55);
        this.createStarTexture(graphics, 'stars-near', 512, 320, 38, 0.9);

        graphics.fillStyle(0xfff260, 1);
        graphics.fillCircle(14, 14, 12);
        graphics.lineStyle(3, 0xffffff, 0.85);
        graphics.strokeCircle(14, 14, 8);
        graphics.generateTexture('beacon', 28, 28);
        graphics.clear();

        graphics.fillStyle(0xff3b6d, 1);
        graphics.fillTriangle(2, 34, 20, 0, 38, 34);
        graphics.fillStyle(0xffffff, 0.8);
        graphics.fillTriangle(16, 11, 20, 3, 24, 11);
        graphics.generateTexture('spike', 40, 34);
        graphics.clear();

        graphics.fillStyle(0xff2a5f, 0.22);
        graphics.fillRoundedRect(0, 0, 32, 160, 14);
        graphics.fillStyle(0xff2a5f, 0.95);
        graphics.fillRoundedRect(11, 0, 10, 160, 5);
        graphics.fillStyle(0xffffff, 0.85);
        graphics.fillRoundedRect(14, 0, 4, 160, 2);
        graphics.generateTexture('laser', 32, 160);
        graphics.clear();

        graphics.fillStyle(0x101525, 1);
        graphics.fillRoundedRect(0, 5, 44, 28, 13);
        graphics.lineStyle(3, 0x00e5ff, 1);
        graphics.strokeRoundedRect(1, 6, 42, 26, 12);
        graphics.fillStyle(0xfff260, 1);
        graphics.fillCircle(14, 19, 4);
        graphics.fillCircle(30, 19, 4);
        graphics.lineStyle(2, 0xff3fb4, 0.9);
        graphics.lineBetween(8, 5, 0, 0);
        graphics.lineBetween(36, 5, 44, 0);
        graphics.generateTexture('drone', 44, 36);
        graphics.clear();

        graphics.destroy();
    }

    createStarTexture(graphics, key, width, height, count, alpha) {
        graphics.clear();
        for (let i = 0; i < count; i += 1) {
            const x = Phaser.Math.Between(0, width);
            const y = Phaser.Math.Between(0, height);
            const radius = Phaser.Math.FloatBetween(0.7, 1.9);
            const color = Phaser.Display.Color.GetColor(
                Phaser.Math.Between(180, 255),
                Phaser.Math.Between(210, 255),
                Phaser.Math.Between(220, 255)
            );
            graphics.fillStyle(color, Phaser.Math.FloatBetween(alpha * 0.45, alpha));
            graphics.fillCircle(x, y, radius);
        }
        graphics.generateTexture(key, width, height);
    }

    createBackground() {
        const { width, height } = this.scale;
        this.bgFar = this.add.tileSprite(0, 0, width, height, 'stars-far')
            .setOrigin(0)
            .setAlpha(0.42)
            .setScrollFactor(0);
        this.bgNear = this.add.tileSprite(0, 0, width, height, 'stars-near')
            .setOrigin(0)
            .setAlpha(0.78)
            .setScrollFactor(0);
    }

    createPlayer() {
        this.player = this.physics.add.sprite(100, 460, 'player');
        this.player.setBounce(0.08);
        this.player.setCollideWorldBounds(true);
        this.player.body.setSize(20, 42).setOffset(6, 6);

        this.anims.create({
            key: 'left',
            frames: this.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
            frameRate: 10,
            repeat: -1
        });
        this.anims.create({
            key: 'turn',
            frames: [{ key: 'player', frame: 4 }],
            frameRate: 20
        });
        this.anims.create({
            key: 'right',
            frames: this.anims.generateFrameNumbers('player', { start: 5, end: 8 }),
            frameRate: 10,
            repeat: -1
        });
    }

    createEffects() {
        this.dustEmitter = this.add.particles(0, 0, 'particle', {
            lifespan: 420,
            speed: { min: 18, max: 62 },
            angle: { min: 180, max: 360 },
            scale: { start: 0.55, end: 0 },
            alpha: { start: 0.8, end: 0 },
            tint: [0x00e5ff, 0xff3fb4, 0x8dff65],
            emitting: false
        });

        this.finishEmitter = this.add.particles(0, 0, 'particle', {
            lifespan: 900,
            speed: { min: 12, max: 42 },
            angle: { min: 230, max: 310 },
            scale: { start: 0.65, end: 0 },
            alpha: { start: 0.85, end: 0 },
            tint: 0xfff260,
            frequency: 90
        });
    }

    createUi() {
        this.hudElement = document.getElementById('hud');
        this.bannerElement = document.getElementById('banner');
        this.createTouchControls();
    }

    createTouchControls() {
        if (!this.sys.game.device.input.touch) {
            return;
        }

        const makeButton = (x, y, label) => {
            const button = this.add.container(x, y).setScrollFactor(0).setDepth(20);
            const bg = this.add.circle(0, 0, 34, 0x081523, 0.62)
                .setStrokeStyle(2, 0x00e5ff, 0.9);
            const text = this.add.text(0, -1, label, {
                fontFamily: 'Segoe UI, Arial, sans-serif',
                fontSize: '26px',
                color: '#ffffff'
            }).setOrigin(0.5);
            button.add([bg, text]);
            button.setSize(68, 68).setInteractive();
            return button;
        };

        this.leftButton = makeButton(58, this.scale.height - 62, '<');
        this.rightButton = makeButton(138, this.scale.height - 62, '>');
        this.jumpButton = makeButton(this.scale.width - 66, this.scale.height - 62, '^');

        this.bindTouchButton(this.leftButton, 'left');
        this.bindTouchButton(this.rightButton, 'right');
        this.bindTouchButton(this.jumpButton, 'jump');
    }

    bindTouchButton(button, key) {
        button.on('pointerdown', () => { this.touchState[key] = true; });
        button.on('pointerup', () => { this.touchState[key] = false; });
        button.on('pointerout', () => { this.touchState[key] = false; });
    }

    createInput() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.rKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this.scale.on('resize', this.handleResize, this);
    }

    loadLevel(index) {
        const level = LEVELS[index];
        this.currentLevel = level;
        this.isTransitioning = false;
        this.isInvulnerable = false;
        this.player.clearTint();

        this.clearLevel();

        this.worldWidth = level.width;
        this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight);
        this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight);

        this.platforms = this.physics.add.staticGroup();
        this.hazards = this.physics.add.staticGroup();
        this.drones = this.physics.add.group({ allowGravity: false, immovable: true });

        level.ground.forEach((segment) => {
            this.addPlatform(segment.x, level.groundY, segment.width);
        });
        level.platforms.forEach((platform) => {
            this.addPlatform(platform.x, platform.y, platform.width);
        });
        level.spikes.forEach((field) => this.addSpikeField(field));
        level.lasers.forEach((laser) => this.addLaser(laser));
        level.drones.forEach((drone) => this.addDrone(drone));

        this.finish = this.physics.add.staticSprite(level.finish.x, level.finish.y - 8, 'beacon')
            .setOrigin(0.5, 1);
        this.finish.refreshBody();
        this.finishEmitter.setPosition(level.finish.x, level.finish.y - 22);

        if (this.finishGlow) {
            this.finishGlow.destroy();
        }
        this.finishGlow = this.add.pointlight(level.finish.x, level.finish.y - 42, 0xfff260, 180, 0.22);

        this.levelColliders.push(this.physics.add.collider(this.player, this.platforms, this.handleLanding, null, this));
        this.levelColliders.push(this.physics.add.overlap(this.player, this.hazards, this.hitHazard, null, this));
        this.levelColliders.push(this.physics.add.overlap(this.player, this.drones, this.hitHazard, null, this));
        this.levelColliders.push(this.physics.add.overlap(this.player, this.finish, this.completeLevel, null, this));

        this.resetPlayer(false);
        this.announceLevel(level.name);
    }

    clearLevel() {
        this.levelColliders.forEach((collider) => collider.destroy());
        this.levelColliders = [];

        if (this.platforms) {
            this.platforms.destroy(true);
        }
        if (this.hazards) {
            this.hazards.destroy(true);
        }
        if (this.drones) {
            this.drones.destroy(true);
        }
        if (this.finish) {
            this.finish.destroy();
        }
    }

    addPlatform(x, y, width) {
        const platform = this.platforms.create(x, y, 'ground')
            .setOrigin(0, 0)
            .setDisplaySize(width, 24);
        platform.refreshBody();
    }

    addSpikeField(field) {
        for (let i = 0; i < field.count; i += 1) {
            const spike = this.hazards.create(field.x + i * 38, field.y, 'spike')
                .setOrigin(0.5, 1);
            spike.setData('kind', 'spike');
            spike.refreshBody();
        }
    }

    addLaser(config) {
        const laser = this.hazards.create(config.x, config.surfaceY - config.height / 2, 'laser')
            .setOrigin(0.5)
            .setDisplaySize(32, config.height);
        laser.setData('kind', 'laser');
        laser.setData('pulse', config.pulse);
        laser.setData('offset', config.offset);
        laser.refreshBody();
    }

    addDrone(route) {
        const drone = this.drones.create(route.x, route.y, 'drone');
        drone.body.allowGravity = false;
        drone.setImmovable(true);
        drone.setVelocityX(route.speed);
        drone.body.setSize(34, 24).setOffset(5, 6);
        drone.setData('minX', route.minX);
        drone.setData('maxX', route.maxX);
        drone.setData('speed', route.speed);
        drone.setData('homeSpeed', route.speed);
        drone.setData('homeX', route.x);
        drone.setData('homeY', route.y);
    }

    handleResize(gameSize) {
        this.bgFar.setSize(gameSize.width, gameSize.height);
        this.bgNear.setSize(gameSize.width, gameSize.height);

        if (this.leftButton) {
            this.leftButton.setPosition(58, gameSize.height - 62);
            this.rightButton.setPosition(138, gameSize.height - 62);
            this.jumpButton.setPosition(gameSize.width - 66, gameSize.height - 62);
        }
    }

    handleLanding(player, platform) {
        if (player.body.velocity.y > 150) {
            this.dustEmitter.emitParticleAt(player.x, platform.y, 10);
        }
    }

    hitHazard(player, hazard) {
        if (this.isInvulnerable || this.isTransitioning || this.hasWon) {
            return;
        }

        this.deaths += 1;
        this.isInvulnerable = true;
        this.cameras.main.shake(220, 0.012);
        this.dustEmitter.emitParticleAt(player.x, player.y + 10, 18);
        this.resetPlayer(true);

        this.time.delayedCall(700, () => {
            this.isInvulnerable = false;
            this.player.clearTint();
        });
    }

    completeLevel() {
        if (this.isTransitioning || this.hasWon) {
            return;
        }

        this.isTransitioning = true;
        this.player.setVelocity(0, 0);
        this.cameras.main.flash(320, 255, 242, 96);
        this.finishEmitter.explode(52, this.finish.x, this.finish.y - 18);

        const nextLevel = this.levelIndex + 1;
        if (nextLevel < LEVELS.length) {
            this.time.delayedCall(650, () => {
                this.levelIndex = nextLevel;
                this.loadLevel(this.levelIndex);
            });
            return;
        }

        this.hasWon = true;
        this.isTransitioning = false;
        const elapsed = this.getElapsedSeconds();
        if (!this.bestTime || elapsed < this.bestTime) {
            this.bestTime = elapsed;
            localStorage.setItem('skyward-neon-best', String(elapsed));
        }
        this.announceLevel('Run Complete');
    }

    announceLevel(message) {
        if (!this.bannerElement) {
            return;
        }

        this.bannerElement.textContent = this.formatAnnouncement(message).toUpperCase();
        this.bannerElement.classList.remove('is-visible');
        void this.bannerElement.offsetWidth;
        this.bannerElement.classList.add('is-visible');
    }

    formatAnnouncement(message) {
        const levelMatch = message.match(/^Level (\d+): (.+)$/);
        if (levelMatch && window.innerWidth < 520) {
            return `L${levelMatch[1]}/${LEVELS.length} ${levelMatch[2]}`;
        }
        return message;
    }

    restartRun() {
        this.levelIndex = 0;
        this.deaths = 0;
        this.runStartTime = this.time.now;
        this.hasWon = false;
        this.isTransitioning = false;
        this.loadLevel(0);
    }

    resetPlayer(fromHazard) {
        const start = this.currentLevel.start;
        this.player.setPosition(start.x, start.y);
        this.player.setVelocity(0, 0);

        if (fromHazard) {
            this.player.setTint(0xff74aa);
        }

        if (this.drones) {
            this.drones.children.iterate((drone) => {
                if (!drone) {
                    return;
                }
                drone.setPosition(drone.getData('homeX'), drone.getData('homeY'));
                drone.setData('speed', drone.getData('homeSpeed'));
                drone.setVelocityX(drone.getData('homeSpeed'));
            });
        }
    }

    getElapsedSeconds() {
        return Math.max(0, (this.time.now - this.runStartTime) / 1000);
    }

    update() {
        this.bgFar.tilePositionX = this.cameras.main.scrollX * 0.08;
        this.bgNear.tilePositionX = this.cameras.main.scrollX * 0.24;
        this.bgNear.tilePositionY = this.cameras.main.scrollY * 0.08;

        this.updateHazards();

        if (Phaser.Input.Keyboard.JustDown(this.rKey)) {
            this.restartRun();
            return;
        }

        const onGround = this.player.body.touching.down || this.player.body.blocked.down;
        if (onGround) {
            this.lastGroundedAt = this.time.now;
        }

        if (!this.isTransitioning && !this.hasWon) {
            this.updatePlayerMovement(onGround);
        } else {
            this.player.setVelocityX(0);
            this.player.anims.play('turn');
        }

        if (this.player.y > this.worldHeight - 16) {
            this.hitHazard(this.player);
        }

        this.updateUi();
    }

    updatePlayerMovement(onGround) {
        const movingLeft = this.cursors.left.isDown || this.touchState.left;
        const movingRight = this.cursors.right.isDown || this.touchState.right;
        const jumpPressed = Phaser.Input.Keyboard.JustDown(this.cursors.up)
            || Phaser.Input.Keyboard.JustDown(this.spaceKey)
            || (this.touchState.jump && !this.touchJumpWasDown);
        this.touchJumpWasDown = this.touchState.jump;

        if (jumpPressed) {
            this.jumpQueuedAt = this.time.now;
        }

        if (movingLeft) {
            this.player.setVelocityX(-PLAYER_SPEED);
            this.player.anims.play('left', true);
            this.emitRunDust(onGround, 1);
        } else if (movingRight) {
            this.player.setVelocityX(PLAYER_SPEED);
            this.player.anims.play('right', true);
            this.emitRunDust(onGround, -1);
        } else {
            this.player.setVelocityX(0);
            this.player.anims.play('turn');
        }

        const canJump = onGround || this.time.now - this.lastGroundedAt <= COYOTE_TIME_MS;
        const hasBufferedJump = this.time.now - this.jumpQueuedAt <= JUMP_BUFFER_MS;
        if (hasBufferedJump && canJump) {
            this.player.setVelocityY(JUMP_VELOCITY);
            this.jumpQueuedAt = -Infinity;
            this.lastGroundedAt = -Infinity;
            this.dustEmitter.emitParticleAt(this.player.x, this.player.y + 22, 12);
        }
    }

    updateHazards() {
        if (this.hazards) {
            this.hazards.children.iterate((hazard) => {
                if (!hazard || hazard.getData('kind') !== 'laser') {
                    return;
                }

                const pulse = hazard.getData('pulse');
                const offset = hazard.getData('offset');
                const cycle = Math.sin((this.time.now + offset) / pulse * Math.PI);
                const active = cycle > -0.25;
                hazard.body.enable = active;
                hazard.setAlpha(active ? 0.92 : 0.18);
            });
        }

        if (this.drones) {
            this.drones.children.iterate((drone) => {
                if (!drone) {
                    return;
                }

                let speed = drone.getData('speed');
                const minX = drone.getData('minX');
                const maxX = drone.getData('maxX');
                if (drone.x <= minX) {
                    speed = Math.abs(speed);
                } else if (drone.x >= maxX) {
                    speed = -Math.abs(speed);
                }
                drone.setData('speed', speed);
                drone.setVelocityX(speed);
                drone.rotation += 0.035 * Math.sign(speed || 1);
            });
        }

        if (this.finishGlow) {
            this.finishGlow.intensity = 0.18 + Math.sin(this.time.now / 180) * 0.04;
        }
    }

    updateUi() {
        if (!this.hudElement) {
            return;
        }

        const elapsed = this.getElapsedSeconds();
        const best = this.bestTime ? `  BEST ${this.bestTime.toFixed(1)}s` : '';
        const level = `L${this.levelIndex + 1}/${LEVELS.length}`;
        const deaths = `DEATHS ${this.deaths}`;
        const time = `${elapsed.toFixed(1)}s`;
        this.hudElement.textContent = this.hasWon ? `RUN COMPLETE  ${time}  ${deaths}${best}` : `${level}  ${time}  ${deaths}${best}`;
    }

    emitRunDust(onGround, direction) {
        if (!onGround || this.time.now % 3 > 1) {
            return;
        }
        this.dustEmitter.emitParticleAt(this.player.x - direction * 12, this.player.y + 22, 1);
    }
}

const config = {
    type: Phaser.AUTO,
    parent: document.body,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#050510',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 900 },
            debug: false
        }
    },
    scene: SkywardScene,
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
        antialias: true,
        pixelArt: false
    }
};

new Phaser.Game(config);
