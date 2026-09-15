const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const layouts = JSON.parse(fs.readFileSync(path.join(root, 'assets/levels.json'))).levels;

function catalog(saved = []) {
    const context = vm.createContext({ localStorage: {
        getItem: () => JSON.stringify(saved), setItem() {}
    } });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/levels.js'), 'utf8').replaceAll('export ', '') +
        '\nglobalThis.api = { LEVELS, isUnlocked, isCompleted, completeLevel };', context);
    return context.api;
}

test('all 20 hub entries have matching layouts, artwork, and valid terrain', () => {
    const { LEVELS } = catalog();
    assert.equal(LEVELS.length, 20);
    assert.equal(layouts.length, 20);
    for (const entry of LEVELS) {
        const matches = layouts.filter(level => level.id === entry.id);
        assert.equal(matches.length, 1);
        const level = matches[0];
        assert.equal(level.title, entry.title);
        assert.equal(entry.playable, true);
        assert.ok(fs.existsSync(path.join(root, `assets/images/levels/Level ${entry.id}.png`)));
        assert.ok(level.groundShapes.length > 0);
        for (const shape of level.groundShapes) {
            assert.ok(shape.points.length >= 3);
            for (const point of shape.points) {
                assert.ok(point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
            }
        }
    }
});

test('saved completion of Level 10 unlocks 11 and progression reaches 20', () => {
    const api = catalog(Array.from({ length: 10 }, (_, i) => i + 1));
    assert.equal(api.isUnlocked(11), true);
    assert.equal(api.isUnlocked(12), false);
    for (let id = 11; id <= 20; id++) {
        assert.equal(api.isUnlocked(id), true);
        api.completeLevel(id);
        assert.equal(api.isCompleted(id), true);
    }
    const restored = catalog(Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(restored.LEVELS.filter(level => restored.isCompleted(level.id)).length, 20);
});

test('hub scroll and hit testing reach the twentieth row', () => {
    const { LEVELS } = catalog();
    const context = vm.createContext({ LEVELS, Phaser: {
        Scene: class {}, Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) }
    } });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/HubScene.js'), 'utf8')
        .replace(/^\uFEFF?import .*;\r?\n/gm, '').replace('export class', 'class') +
        '\nglobalThis.Hub = HubScene;', context);
    const hub = new context.Hub();
    hub.list = {};
    hub.scrollbar = { clear() { return this; }, fillStyle() { return this; }, fillRoundedRect() { return this; } };
    hub.scrollTo(100000);
    assert.equal(hub.scrollOffset, 20 * 176 - 542);
    const lastRowY = 126 + 19 * 176 - hub.scrollOffset + 88;
    assert.ok(lastRowY >= 126 && lastRowY < 668);
    assert.equal(Math.floor((lastRowY - 126 + hub.scrollOffset) / 176), 19);
});
