const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const layouts = JSON.parse(fs.readFileSync(path.join(root, 'assets/levels.json'))).levels;

function catalog(saved = [], testMode) {
    const context = vm.createContext({ layouts, GameScene: class {}, HubScene: class {},
        Phaser: { Game: class {}, Scale: { FIT: 0, CENTER_BOTH: 0 } }, localStorage: {
        getItem: () => JSON.stringify(saved), setItem() {}
    } });
    let source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8').replace(/^import .*;\r?\n/gm, '');
    if (testMode !== undefined) source = source.replace(/const TEST_MODE = (true|false);/, `const TEST_MODE = ${testMode};`);
    vm.runInContext(source +
        '\ninitializeLevels({ levels: layouts });\nglobalThis.api = { LEVELS, isUnlocked, isCompleted, completeLevel };', context);
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

test('test mode unlocks every level without marking them complete', () => {
    const api = catalog();
    for (const level of api.LEVELS) {
        assert.equal(api.isUnlocked(level.id), true);
        assert.equal(api.isCompleted(level.id), false);
    }
    assert.equal(api.isUnlocked(0), false);
    assert.equal(api.isUnlocked(21), false);
    api.completeLevel(13);
    assert.equal(api.isCompleted(13), true);
});

test('saved completion of Level 10 unlocks 11 and progression reaches 20 with test mode off', () => {
    const api = catalog(Array.from({ length: 10 }, (_, i) => i + 1), false);
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

test('hub paginates all 20 levels with bounded navigation and a partial final page', () => {
    const { LEVELS } = catalog();
    const context = vm.createContext({ LEVELS, Phaser: {
        Scene: class {}, Math: { Clamp: (value, min, max) => Math.max(min, Math.min(max, value)) }
    } });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/HubScene.js'), 'utf8')
        .replace(/^\uFEFF?import .*;\r?\n/gm, '').replace('export class', 'class') +
        '\nglobalThis.Hub = HubScene;', context);
    const hub = new context.Hub();
    hub.rows = LEVELS.map(level => ({ level, row: {
        setVisible(value) { this.visible = value; }, setY(value) { this.y = value; }
    } }));
    const button = () => ({ input: {}, setAlpha(value) { this.alpha = value; } });
    hub.previousPage = button();
    hub.nextPage = button();
    hub.pageLabel = { setText(value) { this.text = value; } };
    hub.selectLevel = level => { hub.selected = level; };
    const seen = [];
    for (let page = 0; page < 7; page++) {
        hub.setPage(page);
        const visible = hub.rows.filter(item => item.row.visible);
        assert.equal(visible.length, page === 6 ? 2 : 3);
        visible.forEach((item, index) => {
            assert.equal(item.row.y, index * 160);
            seen.push(item.level.id);
        });
        assert.equal(hub.selected.id, page * 3 + 1);
    }
    assert.deepEqual(seen, Array.from({ length: 20 }, (_, i) => i + 1));
    hub.setPage(100);
    assert.equal(hub.page, 6);
    assert.equal(hub.nextPage.input.enabled, false);
    assert.equal(hub.pageLabel.text, 'PAGE 7 / 7');
    hub.setPage(-1);
    assert.equal(hub.page, 0);
    assert.equal(hub.previousPage.input.enabled, false);
    assert.equal(hub.nextPage.input.enabled, true);
});
