
import { resolveCatRoles, catGeometry } from './cats.js';
import { Seesaw } from './Seesaw.js';
import { Snake } from './Snake.js';

// Set to false to hide physics debug outlines.
const DEBUG_DRAW = false;

export class GameScene extends Phaser.Scene {
    constructor() {
        super("CatPhysicsScene");

        this.SCALE = 30; // pixels per meter
        this.world = null;

        this.ballBody = null;
        this.ballSprite = null;
        this.ballPosition = null;

        this.dragging = false;
        this.pointerWorld = new Phaser.Math.Vector2();

        this.launchStart = { x: 0, y: 0 };

        this.goalZone = null;
        this.levelWon = false;

        this.platformBodies = [];
        this.seesaws = [];
        this.snakes = [];
        this.glassFloors = [];
        this.glassShards = [];
        this.pendingGlassFloors = new Set();

        this.textTitle = null;
        this.textHint = null;
        this.textWin = null;
    }

    init(data = {}) {
        this.levelId = data.levelId ?? globalThis.LEVEL_NUMBER ?? 1;
        globalThis.LEVEL_NUMBER = this.levelId;
        this.savedArrowPositions = data.arrowPositions ?? [];
    }

    preload() {
        this.load.image(`level-${this.levelId}`, `assets/images/levels/Level ${this.levelId}.png`);
        this.load.image('ball', 'assets/images/ball.png');
        this.load.image('black-cat', 'assets/images/black cat.png');
        this.load.image('white-cat', 'assets/images/white cat.png');
        this.load.image('track-mark', 'assets/images/track mark.png');
        this.load.image('track-mark-green', 'assets/images/track mark green.png');
        this.load.image('arrow', 'assets/images/arrow.png');
        this.load.image('bump', 'assets/images/bump.png');
        this.load.image('teeter-totter', 'assets/images/teeter-totter.png');
        this.load.image('trap-door', 'assets/images/trap door.png');
        this.load.image('catapult', 'assets/images/catapult.png');
        this.load.image('glass-floor', 'assets/images/glass floor.png');
        this.load.image('glass-wall', 'assets/images/glass wall.png');
        this.load.image('flipper', 'assets/images/flipper.png');
        this.load.image('snake-segment', 'assets/images/snake segment.png');
        this.load.image('spinner', 'assets/images/spinner.png');
        this.load.json('spinner-geometry', 'assets/json/spinner-geometry.json');
        this.load.image('windmill', 'assets/images/windmill.png');
        this.load.json('windmill-geometry', 'assets/json/windmill-geometry.json');
        this.load.spritesheet('trigger', 'assets/images/trigger.png', { frameWidth: 90, frameHeight: 41 });
        this.load.spritesheet('teleporter', 'assets/images/teleporter.png', { frameWidth: 400, frameHeight: 400 });
    }

    create() {
        this.levelData = LEVELS.find(level => level.id === this.levelId);
        if (!this.levelData || !isUnlocked(this.levelId)) {
            this.scene.start('HubScene');
            return;
        }
        this.levelWon = false;
        this.dragging = false;
        this.restarting = false;
        this.catPassActive = false;
        this.sourceTail = null;
        this.sourceReleased = false;
        this.trackDistance = 0;
        this.ballCourse = [];
        this.arrowBoosts = [];
        this.teleporters = [];
        this.spinnerBodies = [];
        this.bumps = [];
        this.snakes = [];
        this.seesaws = [];
        this.triggerBounds = [];
        this.trapDoors = [];
        this.pendingTrapDoors = new Set();
        this.glassShards = [];
        this.glassFloors = [];
        this.pendingGlassFloors = new Set();
        this.pendingCatapults = new Set();
        this.loadedCatapult = null;
        this.receivingTail = null;
        this.receivingTails = new Map();
        this.catchElapsed = null;
        this.platformBodies = [];

        this.add.image(0, 0, `level-${this.levelId}`)
            .setOrigin(0, 0)
            .setDisplaySize(this.scale.width, this.scale.height)
            .setDepth(-1);

        this.createPlanckWorld();
        this.createLevel();
        this.sourceTail = this.createCatTail(this.sourceCat);
        for (const cat of this.targetCats) {
            this.receivingTails.set(cat.key, this.createCatTail(cat));
        }
        this.createUI();
        this.createDebugOverlay();

        this.input.on("pointerdown", this.onPointerDown, this);
        this.input.on("pointermove", this.onPointerMove, this);
        this.input.on("pointerup", this.onPointerUp, this);
        this.input.on("pointerupoutside", this.onPointerUp, this);
        this.events.once('shutdown', () => {
            this.input.off('pointerdown', this.onPointerDown, this);
            this.input.off('pointermove', this.onPointerMove, this);
            this.input.off('pointerup', this.onPointerUp, this);
            this.input.off('pointerupoutside', this.onPointerUp, this);
            this.events.off('postupdate', this.drawDebugOverlay, this);
            this.world = null;
        });

    }

    createPlanckWorld() {
        const pl = planck;

        this.world = new pl.World({
            gravity: pl.Vec2(0, 12)
        });
        this.world.on('begin-contact', contact => {
            if (this.levelWon || this.dragging) return;
            const a = contact.getFixtureA();
            const b = contact.getFixtureB();
            const trigger = a.getBody() === this.ballBody ? b.getUserData()
                : b.getBody() === this.ballBody ? a.getUserData() : null;
            if (trigger?.triggerSprite && !trigger.triggerSprite.anims.isPlaying) {
                trigger.triggerSprite.play('trigger-press');
            }
            // Defer body removal until after Planck finishes its collision step.
            if (trigger?.trapdoorId) this.pendingTrapDoors.add(trigger.trapdoorId);
            if (trigger?.glassFloor && !trigger.glassFloor.broken) this.pendingGlassFloors.add(trigger.glassFloor);
            if (trigger?.catapult && !trigger.catapult.busy) this.pendingCatapults.add(trigger.catapult);
        });
    }

    createDebugOverlay() {
        this.debugGraphics = this.add.graphics().setDepth(100).setVisible(DEBUG_DRAW);
        this.events.on('postupdate', this.drawDebugOverlay, this);
        this.drawDebugOverlay();
    }

    drawDebugOverlay() {
        const graphics = this.debugGraphics;
        if (!graphics) return;
        graphics.setVisible(DEBUG_DRAW);
        if (!DEBUG_DRAW || !this.world || !this.ballBody) return;
        const w = this.scale.width;
        const h = this.scale.height;
        graphics.clear().lineStyle(2, 0x66ff66, 0.9);
        for (const shape of this.levelData.groundShapes) {
            graphics.beginPath();
            shape.points.forEach(([x, y], i) => {
                if (i === 0) graphics.moveTo(x * w, y * h);
                else graphics.lineTo(x * w, y * h);
            });
            graphics.closePath().strokePath();
        }
        for (const bump of this.bumps) graphics.strokePoints(bump.points, true);
        for (const seesaw of this.seesaws) seesaw.drawDebug(graphics);
        for (const snake of this.snakes) snake.drawDebug(graphics);
        for (const floor of this.glassFloors) {
            if (!floor.broken) graphics.strokeRect(floor.x - floor.width / 2, floor.y, floor.width, floor.height);
        }
        const pos = this.ballBody.getPosition();
        const x = pos.x * this.SCALE;
        const y = pos.y * this.SCALE;
        graphics.lineStyle(1, 0xff9900, 1);
        for (const bounds of this.triggerBounds) {
            graphics.strokePoints(bounds, true);
        }
        graphics.lineStyle(2, 0x66ff66, 0.9);
        for (const { body, contours } of this.spinnerBodies) {
            for (const contour of contours) {
                graphics.strokePoints(contour.map(point => {
                    const world = body.getWorldPoint(point);
                    return { x: world.x * this.SCALE, y: world.y * this.SCALE };
                }), true);
            }
        }
        for (const door of this.trapDoors) {
            if (!door.open) graphics.strokeRect(door.x, door.y, door.width, door.height);
        }
        const angle = this.ballBody.getAngle();
        graphics.lineStyle(2, 0x00ffff, 1);
        graphics.strokeCircle(x, y, this.ballRadius);
        graphics.lineBetween(x, y, x + Math.cos(angle) * this.ballRadius,
            y + Math.sin(angle) * this.ballRadius);
        const goal = this.goalZone;
        graphics.lineStyle(2, 0xffff00, 0.9);
        graphics.strokeRect(goal.x - goal.width / 2, goal.y - goal.height / 2,
            goal.width, goal.height);
        if (this.catPassActive) {
            graphics.lineStyle(2, 0xff66cc, 1);
            graphics.lineBetween(this.passStopX, y - 20, this.passStopX, y + 20);
            graphics.lineBetween(this.passStopX - 10, y, this.passStopX + 10, y);
        }
    }

    createLevel() {
        const w = this.scale.width;
        const h = this.scale.height;
        for (const shape of this.levelData.groundShapes) {
            const points = shape.points.map(([x, y]) => ({ x: x * w, y: y * h }));
            if (shape.texture) {
                const left = Math.min(...points.map(point => point.x));
                const top = Math.min(...points.map(point => point.y));
                const right = Math.max(...points.map(point => point.x));
                const bottom = Math.max(...points.map(point => point.y));
                this.add.image(left, top, shape.texture).setOrigin(0)
                    .setDisplaySize(right - left, bottom - top).setDepth(-0.5);
            } else if (shape.render) {
                const color = Number.parseInt((shape.fill || '#111221').replace('#', ''), 16);
                this.add.graphics().setDepth(-0.5)
                    .fillStyle(color, 1).fillPoints(points, true);
            }
            const body = this.world.createBody();
            // A closed chain follows concave terrain without filling open passages.
            body.createFixture(planck.Chain(points.map(p => planck.Vec2(p.x / this.SCALE, p.y / this.SCALE)), true), {
                friction: 0.85, restitution: 0.1
            });
            this.platformBodies.push(body);
        }
        this.bumps = (this.levelData.bumps || []).map(position => this.createBump(position));
        this.seesaws = (this.levelData.seesaws || []).map(position => new Seesaw(this, position));
        this.snakes = (this.levelData.snakes || []).map(config => new Snake(this, config));
        for (const [index, arrow] of (this.levelData.arrows || []).entries()) {
            const size = (arrow.size ?? 0.09) * Math.min(w, h);
            const position = this.savedArrowPositions[index] ?? arrow;
            const sprite = this.add.image(position.x * w, position.y * h, 'arrow')
                .setDisplaySize(size, size).setAngle(arrow.angle ?? 0).setDepth(0)
                .setInteractive({ useHandCursor: true });
            this.input.setDraggable(sprite);
            if (arrow.oscillation) {
                const { from, to, duration = 1800 } = arrow.oscillation;
                sprite.setRotation(from * Math.PI / 180);
                this.tweens.add({
                    targets: sprite, rotation: to * Math.PI / 180,
                    duration, ease: 'Sine.easeInOut', yoyo: true, repeat: -1
                });
            }
            this.arrowBoosts.push({
                sprite, radius: size / 2,
                boostSpeed: arrow.boostSpeed ?? 12, touching: false
            });
            sprite.on('pointerdown', (pointer, localX, localY, event) => {
                event.stopPropagation();
            });
            sprite.on('drag', (pointer, dragX, dragY) => {
                if (this.levelWon || this.dragging) return;
                const halfSize = size / 2;
                sprite.setPosition(
                    Phaser.Math.Clamp(dragX, halfSize, w - halfSize),
                    Phaser.Math.Clamp(dragY, halfSize, h - halfSize)
                );
            });
        }
        this.createTrapDoors();
        this.createCatapults();
        this.createGlassFloors();
        this.createGlassWalls();
        this.createFlippers();
        this.createPortals();
        this.createSpinners();
        this.createWindmills();
        if (!this.anims.exists('trigger-press')) {
            this.anims.create({
                key: 'trigger-press',
                frames: [0, 1, 0].map(frame => ({ key: 'trigger', frame })),
                frameRate: 8, repeat: 0
            });
        }
        for (const trigger of this.levelData.triggers || []) {
            const fallbackWidth = (trigger.size ?? 0.15) * Math.min(w, h) * 29 / 90;
            const fallbackHeight = fallbackWidth * 14 / 29;
            const points = trigger.points ? trigger.points.map(([x, y]) => ({ x: x * w, y: y * h })) : [
                { x: trigger.x * w - fallbackWidth / 2, y: trigger.y * h - fallbackHeight / 2 },
                { x: trigger.x * w + fallbackWidth / 2, y: trigger.y * h - fallbackHeight / 2 },
                { x: trigger.x * w + fallbackWidth / 2, y: trigger.y * h + fallbackHeight / 2 },
                { x: trigger.x * w - fallbackWidth / 2, y: trigger.y * h + fallbackHeight / 2 }
            ];
            const left = Math.min(...points.map(p => p.x));
            const right = Math.max(...points.map(p => p.x));
            const top = Math.min(...points.map(p => p.y));
            const bottom = Math.max(...points.map(p => p.y));
            const sprite = this.add.sprite((left + right) / 2, bottom, 'trigger', 0)
                .setOrigin(0.5, 1).setDisplaySize(right - left, bottom - top).setDepth(0);
            const body = this.world.createBody();
            const fixture = body.createFixture(planck.Polygon(points.map(point =>
                planck.Vec2(point.x / this.SCALE, point.y / this.SCALE))), { isSensor: true });
            fixture.setUserData({ triggerSprite: sprite, trapdoorId: trigger.trapdoorId });
            this.triggerBounds.push(points);
        }
        const { sourceKey, targetKey, targetKeys } = resolveCatRoles(this.levelData);
        const cats = this.levelData.cats;
        this.sourceCat = catGeometry(sourceKey, cats[sourceKey], cats[targetKey], this.levelData.ballSpawn);
        this.targetCats = targetKeys.map(key => catGeometry(key, cats[key], cats[sourceKey]));
        this.targetCat = this.targetCats[0];
        // Legacy spawn coordinates predate the body-anchored tails.
        const spawn = this.sourceCat.catchPoint;
        this.createBall(spawn.x * w, spawn.y * h, (this.levelData.ballSpawn?.radius ?? 0.01375) * Math.min(w, h));
        this.goalZone = { x: this.targetCat.x * w, y: this.targetCat.groundY * h - 50, width: 90, height: 100 };
        this.add.zone(this.sourceCat.x * w, (this.sourceCat.groundY - 0.085) * h, w * 0.12, h * 0.19)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', (pointer, localX, localY, event) => {
                event.stopPropagation();
                this.passFromCat();
            });
    }

    // Bumps are ordinary static polygons; x/y locate their base.
    createBump({ x, y }) {
        const w = this.scale.width;
        const h = this.scale.height;
        const sprite = this.add.image(x * w, y * h, 'bump')
            .setOrigin(0.5, 1).setDisplaySize(0.085 * w, 0.043 * h).setDepth(-0.5);
        const outline = [
            [-0.0425, 0], [-0.0275, -0.015], [-0.0075, -0.043],
            [0.0075, -0.043], [0.0275, -0.015], [0.0425, 0]
        ];
        const points = outline.map(([dx, dy]) => ({ x: (x + dx) * w, y: (y + dy) * h }));
        const body = this.world.createBody({
            position: planck.Vec2(x * w / this.SCALE, y * h / this.SCALE)
        });
        body.createFixture(planck.Polygon(outline.map(([dx, dy]) =>
            planck.Vec2(dx * w / this.SCALE, dy * h / this.SCALE))), {
            friction: 0.85, restitution: 0.1
        });
        return { sprite, body, points };
    }

    createSpinners() {
        this.createRotatingObstacles(this.levelData.spinners, 'spinner');
    }

    createWindmills() {
        this.createRotatingObstacles(this.levelData.windmills, 'windmill');
    }

    createRotatingObstacles(configs, texture) {
        const w = this.scale.width;
        const h = this.scale.height;
        if (!configs?.length) return;
        const geometry = this.cache.json.get(`${texture}-geometry`);
        // Earcut preserves concave blade edges and the transparent center hole.
        const indices = Phaser.Geom.Polygon.Earcut(geometry.vertices, geometry.holes, 2);
        for (const config of configs) {
            const size = (config.size ?? 0.24) * Math.min(w, h);
            const height = size / (geometry.aspectRatio ?? 1);
            const sprite = this.add.image(config.x * w, config.y * h, texture)
                .setDisplaySize(size, height).setDepth(0);
            if (config.flipX) sprite.setFlipX(true);
            const mirror = config.flipX ? -1 : 1;
            const passive = texture === 'windmill';
            const position = planck.Vec2(sprite.x / this.SCALE, sprite.y / this.SCALE);
            // Windmills turn freely on a fixed axle when struck by the ball.
            const body = passive
                ? this.world.createDynamicBody({ position, gravityScale: 0, angularDamping: 0.6 })
                : this.world.createKinematicBody({ position });
            const points = [];
            for (let i = 0; i < geometry.vertices.length; i += 2) {
                points.push(planck.Vec2(mirror * geometry.vertices[i] * size / this.SCALE,
                    geometry.vertices[i + 1] * height / this.SCALE));
            }
            for (let i = 0; i < indices.length; i += 3) {
                const triangle = indices.slice(i, i + 3).map(index => points[index]);
                // Reflection reverses winding; keep collision polygons consistently oriented.
                if (config.flipX) triangle.reverse();
                body.createFixture(planck.Polygon(triangle), {
                    density: 1, friction: 0.7, restitution: 0.45
                });
            }
            const boundaries = [0, ...geometry.holes, points.length];
            const contours = boundaries.slice(0, -1).map((start, i) => points.slice(start, boundaries[i + 1]));
            this.spinnerBodies.push({ sprite, body, contours, passive });
            if (passive) {
                const axle = this.world.createBody({ position });
                this.world.createJoint(planck.RevoluteJoint({ enableMotor: false }, axle, body, position));
                continue;
            }
            const moveDuration = config.moveDuration ?? 2400;
            if (moveDuration > 0 && Number.isFinite(config.toX) && config.toX !== config.x) {
                this.tweens.add({
                    targets: sprite, x: config.toX * w,
                    duration: moveDuration,
                    ease: 'Sine.easeInOut', yoyo: true, repeat: -1
                });
            }
            this.tweens.add({
                targets: sprite, rotation: (config.clockwise === false ? -1 : 1) * Math.PI * 2,
                duration: config.rotationDuration ?? 1600,
                ease: 'Linear', repeat: -1
            });
        }
    }

    syncSpinnerBodies(dt) {
        for (const { sprite, body, passive } of this.spinnerBodies) {
            if (passive) continue;
            const position = body.getPosition();
            // Reach the tween's current pose during the next physics step, so
            // contacts receive the spinner's linear and angular velocity.
            body.setLinearVelocity(planck.Vec2(
                (sprite.x / this.SCALE - position.x) / dt,
                (sprite.y / this.SCALE - position.y) / dt
            ));
            const angleDelta = sprite.rotation - body.getAngle();
            body.setAngularVelocity(Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta)) / dt);
        }
    }

    createPortals() {
        const teleporters = this.levelData.teleporters || [];
        if (!teleporters.length) return;
        if (!this.anims.exists('teleporter-loop')) {
            this.anims.create({
                key: 'teleporter-loop',
                frames: this.anims.generateFrameNumbers('teleporter', { start: 0, end: 7 }),
                frameRate: 12,
                repeat: -1
            });
        }
        for (const portal of teleporters) {
            const size = (portal.size ?? 0.15) * Math.min(this.scale.width, this.scale.height);
            this.add.sprite(portal.x * this.scale.width, portal.y * this.scale.height, 'teleporter')
                .setDisplaySize(size, size).setDepth(0)
                .play('teleporter-loop');
            if (portal.destination) {
                this.teleporters.push({
                    x: portal.x * this.scale.width, y: portal.y * this.scale.height,
                    radius: size / 2, touching: false,
                    destination: {
                        x: portal.destination.x * this.scale.width,
                        y: portal.destination.y * this.scale.height
                    }
                });
            }
        }
    }

    applyTeleporters(from) {
        if (!this.sourceReleased || this.levelWon || this.dragging || this.loadedCatapult ||
            this.catchElapsed !== null || this.ballBody.getType() !== 'dynamic') return from;
        const position = this.ballBody.getPosition();
        const x = position.x * this.SCALE;
        const y = position.y * this.SCALE;
        const dx = x - from.x;
        const dy = y - from.y;
        const lengthSquared = dx * dx + dy * dy;
        for (const portal of this.teleporters) {
            const radius = this.ballRadius + portal.radius;
            const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
                ((portal.x - from.x) * dx + (portal.y - from.y) * dy) / lengthSquared));
            const hit = Math.hypot(from.x + dx * t - portal.x, from.y + dy * t - portal.y) <= radius;
            const wasTouching = portal.touching;
            portal.touching = Math.hypot(x - portal.x, y - portal.y) <= radius;
            if (!hit || wasTouching) continue;
            const destination = { ...portal.destination };
            // Preserve momentum, but do not sweep collisions or draw a trail across the jump.
            this.ballBody.setTransform(planck.Vec2(destination.x / this.SCALE, destination.y / this.SCALE),
                this.ballBody.getAngle());
            this.ballBody.setAwake(true);
            this.ballPosition = { ...destination };
            this.trackDistance = 0;
            for (const other of this.teleporters) {
                other.touching = Math.hypot(destination.x - other.x, destination.y - other.y)
                    <= this.ballRadius + other.radius;
            }
            for (const arrow of this.arrowBoosts) arrow.touching = false;
            return destination;
        }
        return from;
    }

    createGlassFloors() {
        this.createGlassPanels(this.levelData.glassFloors, 'glass-floor');
    }

    createGlassWalls() {
        this.createGlassPanels(this.levelData.glassWalls, 'glass-wall');
    }

    createGlassPanels(configs, texture) {
        const vertical = texture === 'glass-wall';
        for (const config of configs || []) {
            const image = this.textures.get(texture).getSourceImage();
            const height = vertical ? (config.height ?? 0.24) * this.scale.height
                : (config.width ?? 0.15) * this.scale.width * image.height / image.width;
            const width = vertical ? height * image.width / image.height
                : (config.width ?? 0.15) * this.scale.width;
            const x = config.x * this.scale.width;
            // Wall y is its base; floor y is its top surface.
            const y = config.y * this.scale.height - (vertical ? height : 0);
            const sprite = this.add.image(x, y, texture).setOrigin(0.5, 0)
                .setDisplaySize(width, height).setDepth(0);
            const body = this.world.createBody({ position: planck.Vec2(x / this.SCALE, (y + height / 2) / this.SCALE) });
            const floor = { sprite, body, x, y, width, height, vertical, broken: false };
            body.createFixture(planck.Box(width / 2 / this.SCALE, height / 2 / this.SCALE), {
                friction: 0.5, restitution: 0.1
            }).setUserData({ glassFloor: floor });
            this.glassFloors.push(floor);
        }
    }

    breakGlassFloors() {
        // Contacts queue breakage; Planck bodies can only be removed after stepping.
        for (const floor of this.pendingGlassFloors) {
            if (floor.broken) continue;
            floor.broken = true;
            this.world.destroyBody(floor.body);
            floor.body = null;
            floor.sprite.destroy();
            this.createGlassShards(floor);
        }
        this.pendingGlassFloors.clear();
    }

    createGlassShards(floor) {
        const columns = Math.max(2, Math.min(16, Math.ceil(floor.width / 22)));
        const rows = Math.max(2, Math.min(16, Math.ceil(floor.height / 22)));
        const cellWidth = floor.width / columns;
        const cellHeight = floor.height / rows;
        const impact = this.ballBody.getLinearVelocity();
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const left = floor.x - floor.width / 2 + column * cellWidth;
                const top = floor.y + row * cellHeight;
                for (const triangle of [
                    [[0, 0], [cellWidth, 0], [0, cellHeight]],
                    [[cellWidth, 0], [cellWidth, cellHeight], [0, cellHeight]]
                ]) {
                    const cx = triangle.reduce((sum, p) => sum + p[0], 0) / 3;
                    const cy = triangle.reduce((sum, p) => sum + p[1], 0) / 3;
                    const points = triangle.map(([x, y]) => ({ x: x - cx, y: y - cy }));
                    const body = this.world.createDynamicBody({
                        position: planck.Vec2((left + cx) / this.SCALE, (top + cy) / this.SCALE),
                        angularDamping: 0.15,
                        linearVelocity: planck.Vec2(impact.x * 0.15 + (Math.random() - 0.5) * 3,
                            impact.y * 0.15 - 1 - Math.random() * 2),
                        angularVelocity: (Math.random() - 0.5) * 14
                    });
                    body.createFixture(planck.Polygon(points.map(p => planck.Vec2(p.x / this.SCALE, p.y / this.SCALE))), {
                        density: 0.15, friction: 0.35, restitution: 0.3,
                        // Category 2 is debris; category 4 is flippers.
                        // Shards hit the ball and terrain, but not flippers or each other.
                        filterCategoryBits: 0x0002, filterMaskBits: 0xfff9,
                        filterGroupIndex: -1
                    });
                    const sprite = this.add.graphics().setDepth(0.25);
                    sprite.fillStyle((column + row) % 3 === 0 ? (floor.vertical ? 0x8dbb40 : 0xffc652) : 0xdffaff, 0.9)
                        .fillPoints(points, true).lineStyle(1, 0xffffff, 0.9).strokePoints(points, true);
                    sprite.setPosition(left + cx, top + cy);
                    this.glassShards.push({ body, sprite, age: 0 });
                }
            }
        }
    }

    updateGlassShards(dt) {
        this.glassShards = this.glassShards.filter(shard => {
            shard.age += dt;
            const position = shard.body.getPosition();
            if (shard.age >= 4 || position.y * this.SCALE > this.scale.height + 100) {
                this.world.destroyBody(shard.body);
                shard.sprite.destroy();
                return false;
            }
            shard.sprite.setPosition(position.x * this.SCALE, position.y * this.SCALE);
            shard.sprite.rotation = shard.body.getAngle();
            shard.sprite.setAlpha(Math.min(1, 4 - shard.age));
            return true;
        });
    }

    createFlippers() {
        for (const config of this.levelData.flippers || []) {
            // Width/height are fractions of the screen; size preserves the image ratio.
            const width = config.width !== undefined ? config.width * this.scale.width
                : (config.size ?? 0.22) * Math.min(this.scale.width, this.scale.height);
            const image = this.textures.get('flipper').getSourceImage();
            const height = config.height !== undefined ? config.height * this.scale.height
                : width * image.height / image.width;
            const angle = (config.angle ?? 0) * Math.PI / 180;
            const sprite = this.add.image(config.x * this.scale.width, config.y * this.scale.height, 'flipper')
                .setDisplaySize(width, height).setRotation(angle).setDepth(0);
            const position = planck.Vec2(sprite.x / this.SCALE, sprite.y / this.SCALE);
            const body = this.world.createDynamicBody({ position, angle, gravityScale: 0, angularDamping: 0.8 });
            body.createFixture(planck.Box(width / 2 / this.SCALE, height / 2 / this.SCALE), {
                // More inertia softens the rotation caused by ball impacts.
                density: 0.8, friction: 0.8, restitution: 0.6,
                filterCategoryBits: 0x0004, filterMaskBits: 0xfffd
            });
            const axle = this.world.createBody({ position });
            this.world.createJoint(planck.RevoluteJoint({ enableMotor: false }, axle, body, position));
            const contour = [[-width / 2, -height / 2], [width / 2, -height / 2],
            [width / 2, height / 2], [-width / 2, height / 2]]
                .map(([x, y]) => planck.Vec2(x / this.SCALE, y / this.SCALE));
            this.spinnerBodies.push({ sprite, body, contours: [contour], passive: true });
        }
    }

    createCatapults() {
        for (const config of this.levelData.catapults || []) {
            const width = (config.size ?? 0.2) * Math.min(this.scale.width, this.scale.height);
            const height = width * 73 / 242;
            const direction = config.flipX ? -1 : 1;
            // Mirror around the footprint's center, keeping the fulcrum on the fitting.
            const pivotX = 24 / 242;
            const pivotY = 24 / 73;
            const originX = config.flipX ? 1 - pivotX : pivotX;
            const sprite = this.add.image(config.x * this.scale.width + (originX - 0.94) * width,
                config.y * this.scale.height + (pivotY - 1) * height, 'catapult')
                .setOrigin(originX, pivotY).setFlipX(!!config.flipX)
                .setDisplaySize(width, height).setDepth(0);
            // Separate artwork stays fixed behind the pivot as the arm swings.
            const radius = height * 0.8;
            const baseY = sprite.y + height * 0.4;
            const semicircle = Array.from({ length: 33 }, (_, index) => {
                const angle = Math.PI * index / 32;
                return {
                    x: sprite.x + Math.cos(angle) * radius,
                    y: baseY - Math.sin(angle) * radius
                };
            });
            const base = this.add.graphics().setDepth(-0.25);
            base.fillStyle(0xe52323, 1).fillPoints(semicircle, true);
            base.lineStyle(Math.max(2, width * 0.018), 0x000000, 1).strokePoints(semicircle, true);
            const catapult = {
                sprite, base, config, width, height, direction, busy: false,
                cupOffset: { x: direction * 211 / 242 * width, y: 27 / 73 * height }
            };
            // Cover the entire flat arm (pixels 50–235, 51–68 in the source image).
            const armX = sprite.x + direction * (142.5 / 242 - pivotX) * width;
            const armY = sprite.y + (59.5 / 73 - pivotY) * height;
            const body = this.world.createBody({ position: planck.Vec2(armX / this.SCALE, armY / this.SCALE) });
            body.createFixture(planck.Box(width * 185 / 242 / 2 / this.SCALE,
                height * 17 / 73 / 2 / this.SCALE), { isSensor: true })
                .setUserData({ catapult });
        }
    }

    catapultCup({ sprite, cupOffset }) {
        const cos = Math.cos(sprite.rotation);
        const sin = Math.sin(sprite.rotation);
        return {
            x: sprite.x + cupOffset.x * cos - cupOffset.y * sin,
            y: sprite.y + cupOffset.x * sin + cupOffset.y * cos
        };
    }

    activateCatapults() {
        for (const catapult of this.pendingCatapults) {
            if (catapult.busy || this.loadedCatapult || this.levelWon || this.dragging) continue;
            catapult.busy = true;
            this.loadedCatapult = catapult;
            // Lift the ball from where it entered the arm, around its fixed pivot.
            const position = this.ballBody.getPosition();
            catapult.cupOffset = {
                x: catapult.direction * Phaser.Math.Clamp(
                    catapult.direction * (position.x * this.SCALE - catapult.sprite.x),
                    26 / 242 * catapult.width, 211 / 242 * catapult.width),
                y: 27 / 73 * catapult.height - this.ballRadius
            };
            this.ballBody.setLinearVelocity(planck.Vec2(0, 0));
            this.ballBody.setAngularVelocity(0);
            this.ballBody.setType('static');
            const followCup = () => {
                const cup = this.catapultCup(catapult);
                this.ballBody.setTransform(planck.Vec2(cup.x / this.SCALE, cup.y / this.SCALE), 0);
            };
            followCup();
            this.tweens.add({
                targets: catapult.sprite, angle: -55 * catapult.direction, duration: 180, ease: 'Quad.easeIn',
                onUpdate: followCup,
                onComplete: () => {
                    followCup();
                    const configuredAngle = catapult.config.launchAngle ?? -115;
                    const angle = (catapult.direction === -1 ? 180 - configuredAngle : configuredAngle) * Math.PI / 180;
                    const speed = catapult.config.launchSpeed ?? 24;
                    this.ballBody.setType('dynamic');
                    this.ballBody.setGravityScale(1);
                    this.ballBody.setLinearVelocity(planck.Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed));
                    this.ballBody.setAwake(true);
                    this.loadedCatapult = null;
                    this.tweens.add({
                        targets: catapult.sprite, angle: 0, delay: 120, duration: 220,
                        onComplete: () => { catapult.busy = false; }
                    });
                }
            });
        }
        this.pendingCatapults.clear();
    }

    createTrapDoors() {
        for (const config of this.levelData.trapdoors || []) {
            const x = config.x * this.scale.width;
            const y = config.y * this.scale.height;
            const width = config.width * this.scale.width;
            const height = config.height * this.scale.height;
            const left = this.add.image(x, y + height / 2, 'trap-door')
                .setOrigin(0, 0.5).setDisplaySize(width / 2, height).setDepth(0);
            const right = this.add.image(x + width, y + height / 2, 'trap-door')
                .setOrigin(1, 0.5).setDisplaySize(width / 2, height).setDepth(0);
            const body = this.world.createBody({
                position: planck.Vec2((x + width / 2) / this.SCALE, (y + height / 2) / this.SCALE)
            });
            body.createFixture(planck.Box(width / 2 / this.SCALE, height / 2 / this.SCALE), {
                friction: 0.85, restitution: 0.1
            });
            this.trapDoors.push({ id: config.id, x, y, width, height, left, right, body, open: false });
        }
    }

    openTriggeredTrapDoors() {
        for (const id of this.pendingTrapDoors) {
            const door = this.trapDoors.find(item => item.id === id);
            if (!door || door.open) continue;
            door.open = true;
            this.world.destroyBody(door.body);
            door.body = null;
            this.tweens.add({ targets: door.left, angle: 90, duration: 350, ease: 'Quad.easeIn' });
            this.tweens.add({ targets: door.right, angle: -90, duration: 350, ease: 'Quad.easeIn' });
        }
        this.pendingTrapDoors.clear();
    }

    createCatTail(cat) {
        const { tail } = cat;
        // Level artwork already has the tails removed; preserve the body beneath the joint.
        const textureKey = `${cat.color}-cat`;
        const texture = this.textures.get(textureKey);
        for (let frame = 0; frame < 4; frame++) {
            if (!texture.has(`tail-${frame}`)) {
                texture.add(`tail-${frame}`, 0, frame * 320, 180, 130, 100);
            }
        }
        return this.add.image(this.scale.width * tail.x, this.scale.height * tail.y, textureKey, 'tail-0')
            .setOrigin(0, 1).setFlipX(tail.flipX)
            .setDisplaySize(this.scale.width * tail.width, this.scale.height * tail.height).setDepth(2);
    }

    releaseSourceCat() {
        this.sourceReleased = true;
        this.sourceTail ??= this.createCatTail(this.sourceCat);
        const frames = [1, 2, 3, 3, 2, 1, 0];
        let frame = 0;
        this.time.addEvent({
            delay: 65, repeat: frames.length - 1,
            callback: () => this.sourceTail.setFrame(`tail-${frames[frame++]}`)
        });
        this.textHint.setText(this.targetCats.length > 1
            ? 'Pass the ball to any target cat'
            : `Pass the ball to the ${this.targetCat.color} cat`);
    }

    passFromCat() {
        if (this.levelWon || this.sourceReleased || this.loadedCatapult || this.catchElapsed !== null) return;
        this.dragging = false;
        this.releaseSourceCat();
        this.catPassActive = this.levelData.pass?.mode === 'guided';
        this.ballBody.setType(this.catPassActive ? 'kinematic' : 'dynamic');
        this.ballBody.setGravityScale(1);
        const direction = this.sourceCat.direction;
        const speed = this.levelData.pass?.speed ?? 12;
        this.ballBody.setLinearVelocity(planck.Vec2(this.catPassActive ? 0 : direction * speed, 0));
        this.ballBody.setAngularVelocity(this.catPassActive ? 0 : direction * speed * this.SCALE / this.ballRadius);
        if (this.catPassActive) {
            this.passStopX = this.targetCat.catchPoint.x * this.scale.width;
            this.passStartX = this.ballPosition.x;
            this.passTailY = this.ballPosition.y;
            this.passGroundY = this.sourceCat.groundY * this.scale.height - this.ballRadius;
        }
    }

    openReceivingTail(cat = this.targetCat) {
        if (!this.receivingTails.has(cat.key)) this.receivingTails.set(cat.key, this.createCatTail(cat));
        this.receivingTail = this.receivingTails.get(cat.key);
    }

    createUI() {
        const w = this.scale.width;
        this.add.text(22, 18, 'Menu', {
            fontFamily: 'Arial', fontSize: '24px', color: '#ffffff',
            backgroundColor: '#7d4a2a', padding: { x: 12, y: 8 }
        }).setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.scene.start('HubScene'));

        this.textTitle = this.add.text(w * 0.5, 18, `Level ${this.levelId}: ${this.levelData.title}`, {
            fontFamily: "Arial",
            fontSize: "34px",
            color: "#ffffff",
            fontStyle: "bold",
            stroke: "#a85a1d",
            strokeThickness: 6
        }).setOrigin(0.5, 0);

        this.textHint = this.add.text(18, this.scale.height - 38, `Click the ${this.sourceCat.color} cat to pass the ball`, {
            fontFamily: "Arial",
            fontSize: "22px",
            color: "#fff7e8",
            stroke: "#7b3b10",
            strokeThickness: 4
        });

        this.textWin = this.add.text(this.scale.width * 0.5, 92, "", {
            fontFamily: "Arial",
            fontSize: "36px",
            color: "#ffffff",
            fontStyle: "bold",
            stroke: "#5b8d2a",
            strokeThickness: 6
        }).setOrigin(0.5, 0).setVisible(false);

        const restartBtn = this.add.text(this.scale.width - 22, 18, "Restart", {
            fontFamily: "Arial",
            fontSize: "34px",
            color: "#ffffff",
            backgroundColor: "#7d4a2a",
            padding: { left: 10, right: 10, top: 4, bottom: 4 }
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

        restartBtn.on("pointerdown", () => {
            this.restartWithArrowPositions();
        });
    }

    restartWithArrowPositions() {
        const arrowPositions = this.arrowBoosts.map(({ sprite }) => ({
            x: sprite.x / this.scale.width,
            y: sprite.y / this.scale.height
        }));
        this.scene.restart({ levelId: this.levelId, arrowPositions });
    }

    createBall(x, y, radiusPx = 20) {
        const pl = planck;

        radiusPx *= 1.5;
        const radiusM = radiusPx / this.SCALE;
        this.ballRadius = radiusPx;

        this.ballBody = this.world.createDynamicBody({
            position: pl.Vec2(x / this.SCALE, y / this.SCALE),
            bullet: true,
            linearDamping: 0.35,
            angularDamping: 0.6
        });
        // Hold the ball in the tail curl until the player releases it.
        this.ballBody.setGravityScale(0);

        this.ballBody.createFixture(pl.Circle(radiusM), {
            density: 1.2,
            friction: 0.7,
            restitution: 0.45
        });

        this.ballPosition = { x, y };
        this.ballSprite = this.add.image(x, y, 'ball')
            .setDisplaySize(radiusPx * 2, radiusPx * 2).setDepth(1);
    }

    onPointerDown(pointer) {
        if (this.loadedCatapult) return;
        if (this.levelWon || this.catPassActive || this.catchElapsed !== null) return;

        const dx = pointer.x - this.ballPosition.x;
        const dy = pointer.y - this.ballPosition.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= Math.max(34, this.ballRadius)) {
            if (!this.sourceReleased && this.levelData.pass?.mode === 'guided') {
                this.passFromCat();
                return;
            }
            const vel = this.ballBody.getLinearVelocity();
            if (vel.length() < 3.5) {
                this.dragging = true;
                this.launchStart.x = this.ballPosition.x;
                this.launchStart.y = this.ballPosition.y;
                this.ballBody.setLinearVelocity(planck.Vec2(0, 0));
                this.ballBody.setAngularVelocity(0);
            }
        }
    }

    onPointerMove(pointer) {
        this.pointerWorld.set(pointer.x, pointer.y);

        if (this.dragging) {
            const maxDrag = 120;
            const dx = pointer.x - this.launchStart.x;
            const dy = pointer.y - this.launchStart.y;
            const vec = new Phaser.Math.Vector2(dx, dy);

            if (vec.length() > maxDrag) {
                vec.setLength(maxDrag);
            }

            const newX = this.launchStart.x + vec.x;
            const newY = this.launchStart.y + vec.y;

            this.ballBody.setTransform(
                planck.Vec2(newX / this.SCALE, newY / this.SCALE),
                this.ballBody.getAngle()
            );
            this.ballBody.setLinearVelocity(planck.Vec2(0, 0));
            this.ballBody.setAngularVelocity(0);
        }
    }

    onPointerUp(pointer) {
        if (!this.dragging) return;

        this.dragging = false;

        const dx = this.launchStart.x - pointer.x;
        const dy = this.launchStart.y - pointer.y;

        const impulse = planck.Vec2(dx * 0.095, dy * 0.095);
        const maxImpulse = 18;

        if (impulse.length() > maxImpulse) {
            impulse.mul(maxImpulse / impulse.length());
        }

        if (!this.sourceReleased) this.releaseSourceCat();
        this.ballBody.setGravityScale(1);
        this.ballBody.applyLinearImpulse(impulse, this.ballBody.getWorldCenter(), true);
    }

    update(time, delta = 1000 / 60) {
        if (!this.world || !this.ballBody) return;
        if (this.restarting || this.restartIfOutOfBounds()) return;
        if (this.catchElapsed !== null && !this.levelWon) {
            this.catchElapsed += Math.min(delta, 100);
            this.receivingTail.setFrame(`tail-${Math.max(0, 3 - Math.floor(this.catchElapsed / 80))}`);
            if (this.catchElapsed >= 240) this.finishLevel();
            return;
        }
        if (this.catPassActive && !this.levelWon) {
            // Limit long frames so the receiving animation remains visible.
            const elapsed = Math.min(delta, 100);
            const from = { ...this.ballPosition };
            const direction = Math.sign(this.passStopX - this.passStartX);
            const remainingBefore = Math.abs(this.passStopX - from.x);
            const speed = (this.levelData.pass?.speed ?? 12) * this.SCALE;
            const x = from.x + direction * Math.min(remainingBefore, speed * elapsed / 1000);
            const remaining = Math.abs(this.passStopX - x);
            const groundProgress = Math.max(0, Math.min(1,
                Math.abs(x - this.passStartX) / 60, remaining / 60));
            const blend = groundProgress * groundProgress * (3 - 2 * groundProgress);
            const progress = remainingBefore === 0 ? 1 : Math.min(1,
                Math.abs(x - this.passStartX) / Math.max(1, Math.abs(this.passStopX - this.passStartX)));
            const tailY = this.passTailY + (this.targetCat.catchPoint.y * this.scale.height - this.passTailY) * progress;
            const y = tailY + (this.passGroundY - tailY) * blend;
            this.ballBody.setTransform(planck.Vec2(x / this.SCALE, y / this.SCALE),
                this.ballBody.getAngle() + (x - from.x) / this.ballRadius);
            this.checkReceivingCat(from);
            this.syncBall();
            this.restartIfOutOfBounds();
            return;
        }

        const dt = 1 / 60;
        const previous = this.ballBody.getPosition();
        const from = { x: previous.x * this.SCALE, y: previous.y * this.SCALE };
        this.syncSpinnerBodies(dt);
        for (const snake of this.snakes) snake.step(dt);
        this.world.step(dt);
        for (const snake of this.snakes) snake.sync();
        this.breakGlassFloors();
        this.updateGlassShards(dt);
        for (const seesaw of this.seesaws) seesaw.sync();
        for (const { sprite, body, passive } of this.spinnerBodies) {
            if (passive) sprite.rotation = body.getAngle();
        }
        this.openTriggeredTrapDoors();
        this.activateCatapults();
        const collisionStart = this.applyTeleporters(from);
        this.applyArrowBoosts(collisionStart);
        this.checkReceivingCat(collisionStart);

        this.syncBall();
        this.restartIfOutOfBounds();
    }

    restartIfOutOfBounds() {
        if (this.levelWon || this.restarting) return false;
        const position = this.ballBody.getPosition();
        const x = position.x * this.SCALE;
        const y = position.y * this.SCALE;
        const radius = this.ballRadius;
        // Restart once the entire ball has left any edge of the play area.
        if (x + radius < 0 || x - radius > this.scale.width ||
            y + radius < 0 || y - radius > this.scale.height) {
            this.restarting = true;
            this.restartWithArrowPositions();
            return true;
        }
        return false;
    }

    checkReceivingCat(from) {
        if (!this.sourceReleased || this.loadedCatapult || this.levelWon || this.dragging || this.catchElapsed !== null) return;
        for (const cat of this.targetCats) {
            this.checkReceivingTarget(from, cat);
            if (this.catchElapsed !== null) break;
        }
    }

    checkReceivingTarget(from, cat) {
        const target = {
            x: cat.catchPoint.x * this.scale.width,
            y: cat.catchPoint.y * this.scale.height
        };
        const position = this.ballBody.getPosition();
        const x = position.x * this.SCALE;
        const y = position.y * this.SCALE;
        const dx = x - from.x;
        const dy = y - from.y;
        const distance = Math.hypot(x - target.x, y - target.y);
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
            ((target.x - from.x) * dx + (target.y - from.y) * dy) / lengthSquared));
        const closest = Math.hypot(from.x + dx * t - target.x, from.y + dy * t - target.y);
        const bodyHit = this.hitsReceivingCat(from, { x, y }, cat);
        if (closest > 160 && !bodyHit) return;
        this.openReceivingTail(cat);
        this.receivingTail.setFrame(`tail-${Math.min(3, Math.max(0, Math.floor((160 - distance) / 35)))}`);
        if (closest <= this.ballRadius + 10 || bodyHit) {
            this.ballBody.setLinearVelocity(planck.Vec2(0, 0));
            this.ballBody.setAngularVelocity(0);
            this.ballBody.setTransform(planck.Vec2(target.x / this.SCALE, target.y / this.SCALE), this.ballBody.getAngle());
            this.ballBody.setType('static');
            this.receivingTail.setFrame('tail-3');
            this.catchElapsed = 0;
            this.textHint.setText('Caught!');
        }
    }

    hitsReceivingCat(from, to, cat = this.targetCat) {
        const centerX = cat.x * this.scale.width;
        const groundY = cat.groundY * this.scale.height;
        // Sweep against the cat's body, expanded by the ball radius.
        const bounds = [
            [from.x, to.x - from.x, centerX - 0.023 * this.scale.width - this.ballRadius,
            centerX + 0.023 * this.scale.width + this.ballRadius],
            [from.y, to.y - from.y, groundY - 0.17 * this.scale.height - this.ballRadius,
            groundY + this.ballRadius]
        ];
        let enter = 0;
        let leave = 1;
        for (const [start, delta, min, max] of bounds) {
            if (delta === 0) {
                if (start < min || start > max) return false;
            } else {
                const a = (min - start) / delta;
                const b = (max - start) / delta;
                enter = Math.max(enter, Math.min(a, b));
                leave = Math.min(leave, Math.max(a, b));
                if (enter > leave) return false;
            }
        }
        return true;
    }

    syncBall() {
        const pos = this.ballBody.getPosition();
        const previousX = this.ballPosition.x;
        const previousY = this.ballPosition.y;

        this.ballPosition.x = pos.x * this.SCALE;
        this.ballPosition.y = pos.y * this.SCALE;
        this.ballSprite.setPosition(this.ballPosition.x, this.ballPosition.y);
        this.ballSprite.setRotation(this.ballBody.getAngle());
        this.drawBallTrack(previousX, previousY, this.ballPosition.x, this.ballPosition.y);
    }

    applyArrowBoosts(from) {
        if (this.levelWon || this.dragging || this.ballBody.getType() !== 'dynamic') return;
        const position = this.ballBody.getPosition();
        const x = position.x * this.SCALE;
        const y = position.y * this.SCALE;
        const dx = x - from.x;
        const dy = y - from.y;
        const distanceSquared = dx * dx + dy * dy;
        for (const arrow of this.arrowBoosts) {
            const radius = this.ballRadius + arrow.radius;
            const touching = Math.hypot(x - arrow.sprite.x, y - arrow.sprite.y) <= radius;
            // Sweep the ball's path so fast passes cannot skip the arrow.
            const t = distanceSquared === 0 ? 0 : Math.max(0, Math.min(1,
                ((arrow.sprite.x - from.x) * dx + (arrow.sprite.y - from.y) * dy) / distanceSquared));
            const hit = Math.hypot(from.x + dx * t - arrow.sprite.x,
                from.y + dy * t - arrow.sprite.y) <= radius;
            if (hit && !arrow.touching) {
                const speed = this.ballBody.getLinearVelocity().length() + arrow.boostSpeed;
                const angle = arrow.sprite.rotation;
                this.ballBody.setLinearVelocity(planck.Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed));
                this.ballBody.setAwake(true);
            }
            // Boost once per entry; leaving allows a later hit to boost again.
            arrow.touching = touching;
        }
    }

    drawBallTrack(fromX, fromY, toX, toY) {
        if (this.dragging) {
            this.trackDistance = 0;
            return;
        }
        const dx = toX - fromX;
        const dy = toY - fromY;
        const distance = Math.hypot(dx, dy);
        if (distance === 0) return;
        const spacing = this.ballRadius * 1.8;
        const angle = Math.atan2(dy, dx);
        // Distance-based spacing keeps the trail consistent at any frame rate.
        for (let step = spacing - this.trackDistance; step <= distance; step += spacing) {
            const fraction = step / distance;
            const point = { x: fromX + dx * fraction, y: fromY + dy * fraction, angle };
            this.ballCourse.push(point);
            this.createTrackMark(point, 'track-mark');
        }
        this.trackDistance = (this.trackDistance + distance) % spacing;
    }

    createTrackMark({ x, y, angle }, texture) {
        const mark = this.add.image(x, y, texture)
            .setDisplaySize(this.ballRadius * 1.5, this.ballRadius * 0.6)
            .setRotation(angle).setAlpha(0.7).setDepth(0.5);
        this.tweens.add({
            targets: mark, alpha: 0, delay: 250, duration: 750,
            onComplete: () => mark.destroy()
        });
    }

    showLevelComplete() {
        const w = this.scale.width;
        const h = this.scale.height;
        const panelW = Math.min(w * 0.8, h * 0.75 * 1.5);
        const panelH = panelW / 1.5;
        const left = (w - panelW) / 2;
        const top = (h - panelH) / 2;
        const panel = this.add.container(left, top).setDepth(200).setAlpha(0);
        const frame = this.add.graphics();
        frame.fillStyle(0x171820, 0.65);
        frame.fillRoundedRect(0, 0, panelW, panelH, 28);
        frame.lineStyle(10, 0xffffff, 0.15);
        frame.strokeRoundedRect(0, 0, panelW, panelH, 28);
        frame.lineStyle(3, 0xffffff, 0.95);
        frame.strokeRoundedRect(0, 0, panelW, panelH, 28);
        panel.add(frame);
        panel.add(this.add.text(panelW * 0.5, panelH * 0.14, 'LEVEL COMPLETE!', {
            fontFamily: 'Arial Narrow, Arial, sans-serif', fontSize: `${panelH * 0.105}px`,
            color: '#f1f6b3', stroke: '#252b19', strokeThickness: 4
        }).setOrigin(0.5));
        panel.add(this.add.text(panelW * 0.5, panelH * 0.315, `Level ${this.levelId} complete!`, {
            fontFamily: 'monospace', fontSize: `${panelH * 0.045}px`, color: '#ffffff'
        }).setOrigin(0.5));
        for (const [label, y, action] of [
            ['RETRY', 0.545, () => this.scene.restart({ levelId: this.levelId })],
            ['BACK', 0.795, () => this.scene.start('HubScene')]
        ]) {
            const buttonW = panelW * 0.87;
            const buttonH = panelH * 0.21;
            const buttonX = (panelW - buttonW) / 2;
            const buttonY = panelH * y - buttonH / 2;
            const button = this.add.graphics();
            button.fillStyle(0x090b10, 0.8);
            button.fillRoundedRect(buttonX, buttonY, buttonW, buttonH, 26);
            button.fillStyle(0x777b86, 0.25);
            button.fillRoundedRect(buttonX + 5, buttonY + 5, buttonW - 10, buttonH * 0.43, 20);
            button.lineStyle(4, 0x030406, 0.9);
            button.strokeRoundedRect(buttonX, buttonY, buttonW, buttonH, 26);
            panel.add(button);
            panel.add(this.add.text(panelW * 0.5, panelH * y, label, {
                fontFamily: 'Arial Narrow, Arial, sans-serif', fontSize: `${panelH * 0.09}px`,
                color: '#ffffff', stroke: '#111111', strokeThickness: 3
            }).setOrigin(0.5));
            panel.add(this.add.zone(panelW * 0.5, panelH * y, panelW * 0.87, panelH * 0.21)
                .setInteractive({ useHandCursor: true })
                .on('pointerover', () => button.setAlpha(0.75))
                .on('pointerout', () => button.setAlpha(1))
                .on('pointerdown', action));
        }
        this.tweens.add({ targets: panel, alpha: 1, duration: 300 });
    }

    finishLevel() {
        if (this.levelWon) return;
        this.levelWon = true;
        this.ballBody.setLinearVelocity(planck.Vec2(0, 0));
        this.ballBody.setAngularVelocity(0);
        this.ballBody.setType('static');
        completeLevel(this.levelId);
        globalThis.LEVEL_NUMBER = Math.min(this.levelId + 1, LEVELS.length);
        for (const point of this.ballCourse) this.createTrackMark(point, 'track-mark-green');
        this.time.delayedCall(1000, this.showLevelComplete, [], this);
        this.textWin.setText("Nice Pass!").setVisible(true);
        this.textHint.setText(this.levelId < LEVELS.length
            ? `Level ${this.levelId + 1} unlocked! Choose Levels to continue.`
            : 'All levels complete! Choose Levels to replay a challenge.');

    }
} 
