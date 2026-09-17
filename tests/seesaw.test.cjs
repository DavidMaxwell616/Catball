const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('seesaw anchors a dynamic lever to its bump and follows the physics pose', () => {
    const context = vm.createContext({ Phaser: { Scene: class {} }, planck: {
        Vec2: (x, y) => ({ x, y }), Polygon: points => points,
        Box: (x, y) => ({ x, y }),
        RevoluteJoint: (options, base, lever, anchor) => ({ options, base, lever, anchor })
    } });
    for (const file of ['GameScene.js', 'Seesaw.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8')
            .replace(/^import .*;\r?\n/gm, '').replace('export class', 'class'), context);
    }
    const makeBody = options => ({ ...options, angle: 0,
        setTransform(position, angle) { this.position = position; this.angle = angle; },
        createFixture(shape, material) { this.fixture = { shape, material }; },
        getPosition() { return this.position; }, getAngle() { return this.angle; }
    });
    const scene = {
        scale: { width: 1280, height: 800 }, SCALE: 30,
        textures: { get: () => ({ getSourceImage: () => ({ width: 480, height: 25 }) }) },
        add: { image: (x, y) => ({ x, y,
            setOrigin() { return this; }, setDisplaySize() { return this; },
            setDepth() { return this; }, setPosition(x, y) { this.x = x; this.y = y; }
        }) },
        world: { createBody: makeBody,
            createDynamicBody: options => ({ ...makeBody(options), dynamic: true }),
            createJoint: joint => joint }
    };
    context.scene = scene;
    vm.runInContext('scene.createBump = GameScene.prototype.createBump;', context);
    const seesaw = vm.runInContext('new Seesaw(scene, { x: 0.132, y: 0.4 })', context);
    assert.equal(seesaw.body.dynamic, true);
    assert.equal(seesaw.body.angle, -Math.PI / 12);
    assert.equal(seesaw.sprite.rotation, seesaw.body.angle);
    assert.equal(seesaw.joint.base, seesaw.fulcrum.body);
    assert.equal(seesaw.joint.lever, seesaw.body);
    assert.equal(seesaw.joint.options.enableMotor, false);
    assert.equal(seesaw.joint.options.enableLimit, true);
    assert.ok(seesaw.joint.options.lowerAngle < 0 && seesaw.joint.options.upperAngle > 0);
    assert.equal(seesaw.joint.options.collideConnected, false);
    assert.ok(Math.abs(seesaw.sprite.y + 5 - (0.4 - 0.043) * 800) < 1e-9);
    seesaw.body.angle = 0.2;
    seesaw.sync();
    assert.equal(seesaw.sprite.rotation, 0.2);
    assert.equal(seesaw.sprite.x, seesaw.body.position.x * 30);
});
