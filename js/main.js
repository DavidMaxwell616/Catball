
import { GameScene } from "./GameScene.js";
import { HubScene } from "./HubScene.js";
// Set to false to restore normal level progression.
const TEST_MODE = true;
globalThis.LEVELS = [];
globalThis.LEVEL_NUMBER = 1;

const KEY = 'cat-physics-completed';
let completed = [];
try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) completed = saved.filter(id => Number.isInteger(id) && id > 0);
} catch { /* Keep progress in memory when storage is unavailable. */ }

globalThis.initializeLevels = function (data) {
    // Level numbers follow the JSON order; names come directly from title.
    globalThis.LEVELS = data.levels.map((level, index) => ({
        playable: true, description: '', ...level, id: index + 1
    }));
    completed = completed.filter(id => LEVELS.some(level => level.id === id));
};
globalThis.isCompleted = id => completed.includes(id);
globalThis.isUnlocked = id => LEVELS.some(level => level.id === id) &&
    (TEST_MODE || id === 1 || isCompleted(id - 1));
globalThis.completeLevel = function (id) {
    if (!LEVELS.some(level => level.id === id && level.playable) || !isUnlocked(id)) return;
    if (!completed.includes(id)) completed.push(id);
    try { localStorage.setItem(KEY, JSON.stringify(completed)); } catch { /* Keep session progress. */ }
};

const config = {
    type: Phaser.AUTO,
    parent: "game",
    width: 1280,
    height: 800,
    backgroundColor: "#111111",
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [HubScene, GameScene]
};

new Phaser.Game(config);
