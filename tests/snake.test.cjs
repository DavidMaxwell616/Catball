const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('snake has twelve adjacent solid bars and repeats a 180-pixel wave in both directions', () => {
    const context = vm.createContext({ planck: {
        Vec2: (x, y) => ({ x, y }), Box: (x, y) => ({ x, y })
    } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/Snake.js'), 'utf8')
        .replace('export class', 'class') + '\nglobalThis.Snake = Snake;', context);
    const scene = { SCALE: 30, scale: { width: 1280, height: 800 },
        textures: { get: () => ({ getSourceImage: () => ({ width: 40, height: 360 }) }) },
        add: { image: (x, y) => ({ x, y,
            setDisplaySize(w, h) { this.width = w; this.height = h; return this; },
            setDepth() { return this; }, setPosition(x, y) { this.x = x; this.y = y; }
        }) },
        world: { createKinematicBody: ({ position }) => ({ position,
            createFixture(shape, material) { this.shape = shape; this.material = material; },
            getPosition() { return this.position; }, setLinearVelocity(v) { this.velocity = v; }
        }) }
    };
    const layout = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/levels.json'))).levels.find(l => l.id === 20);
    const snake = new context.Snake(scene, layout.snakes[0]);
    assert.equal(snake.segments.length, 12);
    for (let i = 0; i < 12; i++) {
        const { sprite, body } = snake.segments[i];
        assert.equal(body.shape.x * 60, sprite.width);
        assert.equal(body.shape.y * 60, sprite.height);
        assert.notEqual(body.material.isSensor, true);
        if (i) assert.equal(sprite.x - snake.segments[i - 1].sprite.x, sprite.width);
    }
    const first = snake.segments[0];
    let min = first.sprite.y, max = min;
    const initial = snake.segments.map(s => s.sprite.y);
    for (let step = 0; step < 240; step++) {
        snake.step(1 / 60);
        for (const { body } of snake.segments) body.position.y += body.velocity.y / 60;
        snake.sync();
        min = Math.min(min, first.sprite.y);
        max = Math.max(max, first.sprite.y);
    }
    assert.ok(Math.abs(min - (snake.baseY - 180)) < 1e-8);
    assert.ok(Math.abs(max - (snake.baseY + 180)) < 1e-8);
    snake.segments.forEach((segment, i) => assert.ok(Math.abs(segment.sprite.y - initial[i]) < 1e-8));
});
