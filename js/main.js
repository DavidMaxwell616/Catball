
import { GameScene } from "./GameScene.js";
import { HubScene } from "./HubScene.js";
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
