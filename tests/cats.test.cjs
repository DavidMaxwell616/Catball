const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const levels = JSON.parse(fs.readFileSync(path.join(root, 'assets/json/levels.json'))).levels;
const spinnerGeometry = JSON.parse(fs.readFileSync(path.join(root, 'assets/json/spinner-geometry.json')));
// Use the actual Phaser triangulator when supplied for integration checks.
const triangulate = process.env.PHASER_EARCUT_PATH ? require(process.env.PHASER_EARCUT_PATH) : () => [0, 1, 2];
const Vec2 = (x = 0, y = 0) => ({ x, y,
    length() { return Math.hypot(this.x, this.y); },
    mul(value) { this.x *= value; this.y *= value; }
});
const context = vm.createContext({
    Phaser: { Scene: class {}, Math: { Vector2: class {}, Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) }, Geom: { Polygon: { Earcut: triangulate } } },
    planck: { Vec2, Circle: radius => ({ radius }), Polygon: points => ({ points }), Box: (x, y) => ({ x, y }),
        RevoluteJoint: (options, axle, body, position) => ({ options, axle, body, position }) }, LEVELS: levels, completeLevel() {}
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/cats.js'), 'utf8').replaceAll('export ', '') +
    fs.readFileSync(path.join(root, 'js/GameScene.js'), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace('export class', 'class') +
    '\nglobalThis.api = { GameScene, resolveCatRoles, catGeometry };', context);
const { GameScene, resolveCatRoles, catGeometry } = context.api;

function sceneFor(level) {
    const scene = new GameScene();
    scene.levelData = level;
    scene.levelId = level.id;
    scene.scale = { width: 1280, height: 800 };
    const { sourceKey, targetKey, targetKeys } = resolveCatRoles(level);
    scene.sourceCat = catGeometry(sourceKey, level.cats[sourceKey], level.cats[targetKey], level.ballSpawn);
    scene.targetCats = targetKeys.map(key => catGeometry(key, level.cats[key], level.cats[sourceKey]));
    scene.targetCat = scene.targetCats[0];
    scene.receivingTails = new Map();
    const spawn = scene.sourceCat.catchPoint;
    let position = Vec2(spawn.x * 1280 / 30, spawn.y * 800 / 30);
    let velocity = Vec2();
    let type = 'dynamic';
    scene.ballRadius = 16.5;
    scene.ballPosition = { x: position.x * 30, y: position.y * 30 };
    scene.ballBody = {
        setType(value) { type = value; }, getType() { return type; },
        setAwake() {},
        setGravityScale(value) { this.gravity = value; },
        setLinearVelocity(value) { velocity = value; }, getLinearVelocity() { return velocity; },
        setAngularVelocity(value) { this.spin = value; }, getAngle() { return 0; },
        getWorldCenter() { return position; },
        applyLinearImpulse(value) { velocity = value; },
        setTransform(value) { position = value; }, getPosition() { return position; }
    };
    scene.textHint = { setText(value) { this.text = value; } };
    scene.sourceReleased = false;
    scene.catchElapsed = null;
    scene.loadedCatapult = null;
    scene.catPassActive = false;
    scene.teleporters = (level.teleporters ?? []).filter(portal => portal.destination).map(portal => ({
        x: portal.x * 1280, y: portal.y * 800, radius: portal.size * 800 / 2, touching: false,
        destination: { x: portal.destination.x * 1280, y: portal.destination.y * 800 }
    }));
    scene.arrowBoosts = [];
    scene.spinnerBodies = [];
    scene.timers = [];
    scene.time = { addEvent(event) { scene.timers.push(event); } };
    scene.tails = [];
    scene.createCatTail = cat => {
        const tail = { cat, setFrame(frame) { this.frame = frame; } };
        scene.tails.push(tail);
        return tail;
    };
    scene.world = {};
    scene.syncBall = () => {
        scene.ballPosition = { x: position.x * 30, y: position.y * 30 };
    };
    scene.finishCount = 0;
    scene.finishLevel = () => { scene.finishCount++; scene.levelWon = true; };
    return scene;
}

test('leaving any screen edge restarts the current level exactly once', () => {
    for (const [x, y] of [[-18, 400], [1298, 400], [640, -18], [640, 818]]) {
        const scene = sceneFor(levels[7]);
        const restarts = [];
        scene.arrowBoosts = [{ sprite: { x: 320, y: 600 } }];
        scene.scene = { restart: data => {
            restarts.push(data.levelId);
            assert.equal(data.arrowPositions[0].x, 0.25);
            assert.equal(data.arrowPositions[0].y, 0.75);
        } };
        scene.ballBody.setTransform(Vec2(x / 30, y / 30));
        scene.update(0, 16);
        scene.update(16, 16);
        assert.deepEqual(restarts, [8]);
    }
});

test('visible balls and completed levels do not restart', () => {
    const scene = sceneFor(levels[7]);
    scene.scene = { restart() { assert.fail('unexpected restart'); } };
    for (const [x, y] of [[-10, 400], [1290, 400], [640, -10], [640, 810], [640, 400]]) {
        scene.ballBody.setTransform(Vec2(x / 30, y / 30));
        assert.equal(scene.restartIfOutOfBounds(), false);
    }
    scene.levelWon = true;
    scene.ballBody.setTransform(Vec2(-100, -100));
    assert.equal(scene.restartIfOutOfBounds(), false);
});

for (const level of levels) {
    for (const swap of [false, true]) {
        test(`Level ${level.id}: throw and swept catch${swap ? ' with swapped colors' : ''}`, () => {
            const data = structuredClone(level);
            if (swap) {
                for (const [key, cat] of Object.entries(data.cats)) {
                    cat.color = key === 'black' ? 'white' : 'black';
                }
            }
            const scene = sceneFor(data);
            scene.passFromCat();
            assert.equal(scene.sourceReleased, true);
            assert.equal(scene.tails[0].cat.color, scene.sourceCat.color);
            assert.match(scene.textHint.text, new RegExp(scene.targetCats.length > 1 ? 'any target cat' : scene.targetCat.color));
            const expectedType = data.pass?.mode === 'guided' ? 'kinematic' : 'dynamic';
            assert.equal(scene.ballBody.getType(), expectedType);
            if (expectedType === 'dynamic') {
                assert.equal(Math.sign(scene.ballBody.getLinearVelocity().x), scene.sourceCat.direction);
                assert.equal(scene.ballBody.gravity, 1);
            }
            scene.passFromCat();
            assert.equal(scene.timers.length, 1, 'source releases only once');
            const target = scene.targetCat.catchPoint;
            const x = target.x * 1280;
            const y = target.y * 800;
            scene.ballBody.setTransform(Vec2((x + 240) / 30, y / 30));
            scene.checkReceivingCat({ x: x - 240, y });
            assert.equal(scene.catchElapsed, 0, 'fast ball crossing the target must be caught');
            assert.equal(scene.receivingTail.cat.color, scene.targetCat.color);
            assert.equal(scene.ballBody.getType(), 'static');
            assert.equal(scene.receivingTail.frame, 'tail-3');
            assert.ok(Math.abs(scene.ballBody.getPosition().x * 30 - x) < 1e-9);
            scene.onPointerDown({ x, y });
            assert.equal(scene.dragging, false, 'cannot drag during catch');
            scene.update(0, 80);
            assert.equal(scene.receivingTail.frame, 'tail-2');
            scene.update(80, 80);
            assert.equal(scene.finishCount, 0);
            scene.update(160, 80);
            assert.equal(scene.receivingTail.frame, 'tail-0');
            assert.equal(scene.finishCount, 1);
        });
    }
}

test('explicit roles support arbitrary identifiers and identical colors', () => {
    const level = { id: 99, sourceCat: 'first', targetCat: 'second', cats: {
        first: { color: 'white', x: 0.2, groundY: 0.9 },
        second: { color: 'white', x: 0.8, groundY: 0.9 }
    } };
    const scene = sceneFor(level);
    scene.passFromCat();
    assert.equal(scene.sourceCat.key, 'first');
    assert.equal(scene.targetCat.key, 'second');
    assert.equal(scene.sourceCat.color, scene.targetCat.color);
    assert.throws(() => resolveCatRoles({ ...level, targetCat: 'first' }));
});

test('catch ignores unreleased balls, dragging, catapult loading, and distant misses', () => {
    const scene = sceneFor(levels[5]);
    const x = scene.targetCat.catchPoint.x * 1280;
    const y = scene.targetCat.catchPoint.y * 800;
    scene.ballBody.setTransform(Vec2(x / 30, y / 30));
    scene.checkReceivingCat({ x, y });
    assert.equal(scene.catchElapsed, null);
    scene.sourceReleased = true;
    scene.dragging = true;
    scene.checkReceivingCat({ x, y });
    assert.equal(scene.catchElapsed, null);
    scene.dragging = false;
    scene.loadedCatapult = {};
    scene.checkReceivingCat({ x, y });
    assert.equal(scene.catchElapsed, null);
    scene.loadedCatapult = null;
    scene.ballBody.setTransform(Vec2(x / 30, (y - 300) / 30));
    scene.checkReceivingCat({ x, y: y - 400 });
    assert.equal(scene.catchElapsed, null);
});

test('body hits catch even when the sweep misses the tail curl', () => {
    const scene = sceneFor(levels[5]);
    scene.passFromCat();
    const x = scene.targetCat.x * 1280;
    const y = (scene.targetCat.groundY - 0.13) * 800;
    scene.ballBody.setTransform(Vec2((x + 300) / 30, y / 30));
    scene.checkReceivingCat({ x: x - 300, y });
    assert.equal(scene.catchElapsed, 0);
});

test('dragging the initial ball releases its source tail and prevents a second cat throw', () => {
    const scene = sceneFor(levels[5]);
    const pointer = { ...scene.ballPosition };
    scene.onPointerDown(pointer);
    assert.equal(scene.dragging, true);
    assert.equal(scene.sourceReleased, false);
    scene.onPointerUp({ x: pointer.x + 100, y: pointer.y + 20 });
    assert.equal(scene.sourceReleased, true);
    assert.equal(scene.dragging, false);
    assert.equal(scene.ballBody.gravity, 1);
    assert.ok(scene.ballBody.getLinearVelocity().x < 0);
    scene.passFromCat();
    assert.equal(scene.timers.length, 1);
    const timer = scene.timers[0];
    for (let frame = 0; frame <= timer.repeat; frame++) timer.callback();
    assert.equal(scene.sourceTail.frame, 'tail-0');
});

test('tail sprites use their cat color and orientation without covering the body with patches', () => {
    const scene = sceneFor(levels[5]);
    const sprites = [];
    const frames = new Set();
    const texture = { has: key => frames.has(key), add: key => frames.add(key) };
    scene.textures = {
        get(key) {
            return key.startsWith('level-') ? { getSourceImage: () => ({ width: 2025, height: 1351 }) } : texture;
        },
        exists: () => false,
        createCanvas: () => ({ context: { drawImage() {} }, refresh() {} })
    };
    scene.add = { image(x, y, key) {
        const sprite = { x, y, key,
            setOrigin() { return this; }, setDisplaySize() { return this; },
            setDepth() { return this; }, setFlipX(value) { this.flipX = value; return this; }
        };
        sprites.push(sprite);
        return sprite;
    } };
    for (const cat of [scene.sourceCat, scene.targetCat]) {
        const sprite = GameScene.prototype.createCatTail.call(scene, cat);
        assert.equal(sprite.key, `${cat.color}-cat`);
        assert.equal(sprite.flipX, cat.tail.flipX);
        assert.equal(sprite.x, cat.tail.x * 1280);
    }
    assert.equal(sprites.length, 2);
    assert.equal(frames.size, 4);
});

for (const direction of [-1, 1]) {
    test(`guided pass catches when traveling ${direction < 0 ? 'left' : 'right'}`, () => {
        const scene = sceneFor({ id: 42, pass: { mode: 'guided' }, cats: {
            black: { x: direction > 0 ? 0.2 : 0.8, groundY: 0.9 },
            white: { x: direction > 0 ? 0.8 : 0.2, groundY: 0.9 }
        } });
        scene.passFromCat();
        for (let frame = 0; frame < 300 && !scene.levelWon; frame++) scene.update(frame * 16, 16);
        assert.equal(scene.levelWon, true);
        assert.equal(scene.finishCount, 1);
    });
}

for (const angle of [235, 285, 335]) {
    test(`oscillating arrow boosts a swept ball in its current ${angle} degree direction`, () => {
        const scene = sceneFor(levels[7]);
        const config = { x: 0.5, y: 0.5, size: 0.09 };
        const sprite = { x: config.x * 1280, y: config.y * 800, rotation: angle * Math.PI / 180 };
        const arrow = { sprite, radius: config.size * 800 / 2, boostSpeed: 12, touching: false };
        scene.arrowBoosts = [arrow];
        scene.ballBody.setLinearVelocity(Vec2(3, 4));
        scene.ballBody.setTransform(Vec2(sprite.x / 30, sprite.y / 30));
        scene.applyArrowBoosts({ x: sprite.x - 200, y: sprite.y });
        const velocity = scene.ballBody.getLinearVelocity();
        assert.ok(Math.abs(velocity.x - Math.cos(sprite.rotation) * 17) < 1e-9);
        assert.ok(Math.abs(velocity.y - Math.sin(sprite.rotation) * 17) < 1e-9);
        sprite.rotation += 0.1;
        scene.applyArrowBoosts(sprite);
        assert.equal(scene.ballBody.getLinearVelocity(), velocity, 'overlap must not boost repeatedly');
        scene.ballBody.setTransform(Vec2((sprite.x + 200) / 30, sprite.y / 30));
        scene.applyArrowBoosts(sprite);
        scene.ballBody.setTransform(Vec2((sprite.x - 200) / 30, sprite.y / 30));
        scene.applyArrowBoosts({ x: sprite.x + 200, y: sprite.y });
        assert.ok(Math.abs(scene.ballBody.getLinearVelocity().length() - 29) < 1e-9,
            'a fast crossing after leaving boosts again');
    });
}

for (const key of ['black', 'black-middle', 'black-bottom']) {
    test(`Level 10 completes when ${key} catches the ball`, () => {
        const scene = sceneFor(levels.find(level => level.id === 10));
        scene.passFromCat();
        assert.equal(scene.sourceCat.key, 'white');
        assert.equal(scene.targetCats.length, 3);
        const cat = scene.targetCats.find(cat => cat.key === key);
        const x = cat.catchPoint.x * 1280;
        const y = cat.catchPoint.y * 800;
        scene.ballBody.setTransform(Vec2((x + 50) / 30, y / 30));
        scene.checkReceivingCat({ x: x - 100, y });
        assert.equal(scene.catchElapsed, 0);
        assert.equal(scene.receivingTail.cat.key, key);
        assert.equal(scene.receivingTail.cat.color, 'black');
        for (let i = 0; i < 3; i++) scene.update(i * 80, 80);
        assert.equal(scene.finishCount, 1);
    });
}

test('spinners and windmills have rotating colliders; only Level 7 spinners travel', () => {
    for (const id of [7, 10, 11, 13]) {
        const scene = sceneFor(levels.find(level => level.id === id));
        const tweens = [];
        scene.cache = { json: { get: key => key === 'windmill-geometry'
            ? JSON.parse(fs.readFileSync(path.join(root, 'assets/json/windmill-geometry.json')))
            : spinnerGeometry } };
        scene.world.createKinematicBody = ({ position }) => ({
            fixtures: [],
            getPosition: () => position, getAngle: () => 0,
            createFixture(shape, options) { this.fixtures.push({ shape, options }); },
            setLinearVelocity(value) { this.velocity = value; },
            setAngularVelocity(value) { this.spin = value; }
        });
        const joints = [];
        scene.world.createBody = options => options;
        scene.world.createJoint = joint => joints.push(joint);
        scene.world.createDynamicBody = options => {
            assert.equal(options.gravityScale, 0);
            const body = scene.world.createKinematicBody(options);
            body.getAngle = () => 0.5;
            return body;
        };
        scene.add = { image(x, y) {
            return { x, y, rotation: 0, setDisplaySize() { return this; }, setDepth() { return this; },
                setFlipX(value) { this.flipX = value; return this; } };
        } };
        scene.tweens = { add: config => tweens.push(config) };
        if (id === 11) scene.createWindmills();
        else scene.createSpinners();
        const count = (scene.levelData.windmills ?? scene.levelData.spinners).length;
        assert.ok(count > 0);
        assert.equal(tweens.filter(tween => 'rotation' in tween).length, id === 11 ? 0 : count);
        if (id === 11) {
            assert.equal(count, 9);
            assert.equal(joints.length, 9);
            assert.ok(joints.every(joint => joint.options.enableMotor === false));
        }
        assert.equal(tweens.filter(tween => 'x' in tween).length, id === 7 ? count : 0);
        assert.equal(scene.spinnerBodies.length, count);
        if (id === 13) {
            scene.spinnerBodies.forEach(({ sprite, contours }, index) => {
                const mirrored = index === 1 || index === 2;
                assert.equal(!!sprite.flipX, mirrored);
                const size = scene.levelData.spinners[index].size * 800 / 30;
                assert.ok(Math.abs(contours[0][0].x - spinnerGeometry.vertices[0] * size * (mirrored ? -1 : 1)) < 1e-9);
            });
        }
        for (const { sprite, body, contours } of scene.spinnerBodies) {
            assert.equal(contours.length, id === 11 ? 1 : 2, 'windmill has a solid hub; spinner has a hole');
            assert.ok(body.fixtures.length > 0);
            for (const { shape, options } of body.fixtures) {
                assert.equal(shape.points.length, 3);
                assert.notEqual(options.isSensor, true);
                const [a, b, c] = shape.points;
                assert.ok(Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-8);
            }
            sprite.x += 6;
            sprite.rotation = Math.PI * 2 - 0.1;
            scene.syncSpinnerBodies(1 / 60);
            if (id === 11) {
                assert.equal(body.velocity, undefined, 'physics controls passive windmill velocity');
                assert.equal(body.spin, undefined, 'no forced rotation before impact');
                continue;
            }
            assert.ok(Math.abs(body.velocity.x - 12) < 1e-9);
            assert.equal(body.velocity.y, 0);
            assert.ok(Math.abs(body.spin + 6) < 1e-9, 'rotation wraps without a full-turn velocity spike');
        }
    }
});

test('manual restart preserves moved arrow positions without leaking them into a new level', () => {
    const scene = sceneFor(levels[8]);
    scene.arrowBoosts = [{ sprite: { x: 320, y: 600 } }, { sprite: { x: 960, y: 200 } }];
    let restartData;
    scene.scene = { restart(data) { restartData = data; } };
    scene.restartWithArrowPositions();
    assert.equal(restartData.levelId, 9);
    assert.equal(restartData.arrowPositions[0].x, 0.25);
    assert.equal(restartData.arrowPositions[0].y, 0.75);
    assert.equal(restartData.arrowPositions[1].x, 0.75);
    assert.equal(restartData.arrowPositions[1].y, 0.25);
    scene.init(restartData);
    assert.equal(scene.savedArrowPositions, restartData.arrowPositions);
    scene.init({ levelId: 10 });
    assert.equal(scene.savedArrowPositions.length, 0);
});

test('Level 6 teleports a fast crossing ball to 75% width and height without changing momentum', () => {
    const scene = sceneFor(levels[5]);
    scene.passFromCat();
    const portal = scene.teleporters[0];
    const velocity = scene.ballBody.getLinearVelocity();
    const spin = scene.ballBody.spin;
    scene.ballBody.setTransform(Vec2((portal.x + 200) / 30, portal.y / 30));
    const from = scene.applyTeleporters({ x: portal.x - 200, y: portal.y });
    assert.equal(from.x, 960);
    assert.equal(from.y, 600);
    assert.equal(scene.ballBody.getPosition().x * 30, 960);
    assert.equal(scene.ballBody.getPosition().y * 30, 600);
    assert.equal(scene.ballBody.getLinearVelocity(), velocity);
    assert.equal(scene.ballBody.spin, spin);
    assert.equal(scene.ballPosition.x, 960, 'trail starts at exit, not entrance');
    assert.equal(scene.trackDistance, 0);
});

test('teleporters ignore misses and dragging, and cannot loop while overlapping an exit', () => {
    const scene = sceneFor(levels[5]);
    scene.passFromCat();
    const portal = scene.teleporters[0];
    scene.ballBody.setTransform(Vec2(portal.x / 30, (portal.y + 200) / 30));
    const miss = { x: portal.x - 200, y: portal.y + 200 };
    assert.equal(scene.applyTeleporters(miss), miss);
    scene.ballBody.setTransform(Vec2(portal.x / 30, portal.y / 30));
    scene.dragging = true;
    const from = { x: portal.x, y: portal.y };
    assert.equal(scene.applyTeleporters(from), from);
    scene.dragging = false;
    scene.teleporters.push({ x: 960, y: 600, radius: 60, touching: false,
        destination: { x: 100, y: 100 } });
    const exit = scene.applyTeleporters(from);
    assert.equal(scene.teleporters[1].touching, true);
    assert.equal(scene.applyTeleporters(exit), exit);
    assert.equal(scene.ballBody.getPosition().x * 30, 960);
});

test('mirrored catapult lifts from the left of its pivot and launches upward to the right', () => {
    for (const direction of [1, -1]) {
        const scene = sceneFor(levels.find(level => level.id === 12));
        const catapult = { direction, width: 160, height: 48,
            sprite: { x: 400, y: 650, rotation: 0 },
            config: { launchAngle: -115, launchSpeed: 24 } };
        scene.ballBody.setTransform(Vec2((400 + direction * 80) / 30, 640 / 30));
        scene.pendingCatapults = new Set([catapult]);
        const tweens = [];
        scene.tweens = { add: tween => tweens.push(tween) };
        scene.activateCatapults();
        assert.equal(Math.sign(catapult.cupOffset.x), direction);
        assert.equal(tweens[0].angle, -55 * direction);
        catapult.sprite.rotation = tweens[0].angle * Math.PI / 180;
        tweens[0].onComplete();
        const velocity = scene.ballBody.getLinearVelocity();
        assert.equal(Math.sign(velocity.x), -direction);
        assert.ok(velocity.y < 0);
        assert.equal(scene.ballBody.getType(), 'dynamic');
        assert.equal(scene.loadedCatapult, null);
    }
});

test('Level 15 glass floors meet edge-to-edge and break once; flippers pivot freely', () => {
    const scene = sceneFor(levels.find(level => level.id === 15));
    const joints = [], removed = [], tweens = [];
    const body = options => ({ ...options, fixtures: [],
        getPosition() { return this.position; }, getAngle() { return 0.3; },
        createFixture(shape, material) {
            const fixture = { shape, material, setUserData(data) { this.data = data; } };
            this.fixtures.push(fixture);
            return fixture;
        }
    });
    scene.world = { createBody: body, createDynamicBody: options => ({ ...body(options), dynamic: true }),
        createJoint: joint => joints.push(joint), destroyBody: body => removed.push(body) };
    scene.textures = { get: key => ({ getSourceImage: () => key === 'flipper'
        ? { width: 321, height: 40 } : { width: 452, height: 56 } }) };
    scene.add = { image: (x, y) => ({ x, y, setOrigin() { return this; },
        setDisplaySize() { return this; }, setRotation(angle) { this.rotation = angle; return this; },
        setDepth() { return this; }, destroy() { this.destroyed = true; } }) };
    scene.tweens = { add: tween => tweens.push(tween) };
    scene.add.graphics = () => ({
        setDepth() { return this; }, fillStyle() { return this; }, fillPoints() { return this; },
        lineStyle() { return this; }, strokePoints() { return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setAlpha(value) { this.alpha = value; }, destroy() { this.destroyed = true; }
    });
    scene.createGlassFloors();
    const [left, right] = scene.glassFloors;
    assert.equal(scene.glassFloors.length, 2);
    assert.ok(Math.abs(left.x + left.width / 2 - (right.x - right.width / 2)) < 1e-9);
    assert.equal(left.y, right.y);
    assert.equal(left.body.fixtures[0].data.glassFloor, left);
    scene.pendingGlassFloors.add(left);
    assert.equal(removed.length, 0, 'removal is deferred until after physics');
    scene.breakGlassFloors();
    scene.pendingGlassFloors.add(left);
    scene.breakGlassFloors();
    assert.equal(removed.length, 1);
    assert.equal(left.body, null);
    assert.equal(right.broken, false);
    assert.equal(left.sprite.destroyed, true);
    assert.ok(scene.glassShards.length >= 12);
    const shards = [...scene.glassShards];
    for (const shard of shards) {
        assert.equal(shard.body.dynamic, true);
        assert.equal(shard.body.fixtures[0].shape.points.length, 3);
        assert.notEqual(shard.body.fixtures[0].material.isSensor, true);
        assert.ok(Number.isFinite(shard.body.angularVelocity));
    }
    scene.updateGlassShards(0.5);
    assert.equal(shards[0].sprite.rotation, 0.3);
    scene.updateGlassShards(3.6);
    assert.equal(scene.glassShards.length, 0);
    assert.equal(removed.length, 1 + shards.length);
    assert.ok(shards.every(shard => shard.sprite.destroyed));
    scene.levelData = structuredClone(scene.levelData);
    scene.levelData.flippers[0].width = 0.3;
    scene.levelData.flippers[0].height = 0.04;
    scene.levelData.flippers[1].width = 0.18;
    delete scene.levelData.flippers[1].height;
    delete scene.levelData.flippers[2].width;
    delete scene.levelData.flippers[2].height;
    scene.levelData.flippers[2].size = 0.35;
    scene.createFlippers();
    const expectedWidths = [0.3 * 1280, 0.18 * 1280, 0.35 * 800];
    const expectedHeights = [0.04 * 800, expectedWidths[1] * 40 / 321, expectedWidths[2] * 40 / 321];
    scene.spinnerBodies.forEach(({ body, contours }, index) => {
        assert.ok(Math.abs(body.fixtures[0].shape.x * 60 - expectedWidths[index]) < 1e-9);
        assert.ok(Math.abs(body.fixtures[0].shape.y * 60 - expectedHeights[index]) < 1e-9);
        assert.equal(contours[0][0].x, -body.fixtures[0].shape.x);
        assert.equal(contours[0][0].y, -body.fixtures[0].shape.y);
    });
    assert.equal(scene.spinnerBodies.length, 3);
    assert.equal(joints.length, 3);
    for (const flipper of scene.spinnerBodies) {
        assert.equal(flipper.passive, true);
        assert.equal(flipper.body.dynamic, true);
        assert.equal(flipper.body.gravityScale, 0);
    }
    assert.ok(joints.every(joint => joint.options.enableMotor === false));
    const debrisFilter = shards[0].body.fixtures[0].material;
    const flipperFilter = scene.spinnerBodies[0].body.fixtures[0].material;
    assert.equal(debrisFilter.filterMaskBits & flipperFilter.filterCategoryBits, 0);
    assert.equal(flipperFilter.filterMaskBits & debrisFilter.filterCategoryBits, 0);
    assert.notEqual(debrisFilter.filterMaskBits & 1, 0, 'shards still collide with ball and terrain');
    assert.notEqual(flipperFilter.filterMaskBits & 1, 0, 'ball still moves flippers');
    scene.levelData = levels.find(level => level.id === 17);
    scene.textures.get = () => ({ getSourceImage: () => ({ width: 67, height: 382 }) });
    scene.createGlassWalls();
    const wall = scene.glassFloors.at(-1);
    assert.equal(wall.vertical, true);
    assert.ok(Math.abs(wall.y + wall.height - 0.6 * 800) < 1e-9, 'wall base rests on middle platform');
    assert.ok(Math.abs(wall.width / wall.height - 67 / 382) < 1e-9);
    scene.pendingGlassFloors.add(wall);
    scene.breakGlassFloors();
    assert.equal(wall.broken, true);
    assert.ok(scene.glassShards.length > 0);
    for (const shard of scene.glassShards) {
        const ys = shard.body.fixtures[0].shape.points.map(point => point.y * 30);
        assert.ok(Math.max(...ys) - Math.min(...ys) <= 22, 'wall breaks into small pieces');
    }
});
