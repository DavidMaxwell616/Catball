import { LEVELS, isCompleted, isUnlocked } from './levels.js';

const TOP = 126, HEIGHT = 542, ROW = 176;

export class HubScene extends Phaser.Scene {
    constructor() { super('HubScene'); }

    create() {
        this.scrollOffset = 0;
        this.rows = [];
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x210d27, 0x210d27, 0xa72c43, 0x891e3a);
        bg.fillRect(0, 0, 1280, 800);
        bg.lineStyle(18, 0xf0b4bd, 0.025);
        for (let i = 0; i < 7; i++) bg.strokeCircle(240 + i * 148, 560, 65 + i * 22);
        bg.fillStyle(0xffc6a2, 0.035);
        for (let y = 155; y < 800; y += 32) {
            for (let x = 24; x < 1280; x += 32) bg.fillCircle(x, y, 3);
        }
        this.heading(36, 24, 'SELECT A CHALLENGE', 58, '#e7dca5');
        this.heading(1234, 40, `${LEVELS.filter(level => isCompleted(level.id)).length} / ${LEVELS.length} COMPLETE`, 32, '#e7dca5').setOrigin(1, 0);
        this.list = this.add.container(0, TOP);
        bg.lineStyle(2, 0xe6cddd, 0.55).lineBetween(32, 111, 1244, 111);
        LEVELS.forEach((level, index) => this.createRow(level, index));
        const clip = this.make.graphics({ x: 0, y: 0 });
        clip.fillStyle(0xffffff).fillRect(28, TOP, 1202, HEIGHT);
        this.list.setMask(clip.createGeometryMask());
        this.scrollbar = this.add.graphics();
        const footer = this.add.graphics();
        footer.fillStyle(0x250d26, 0.96).fillRect(0, 684, 1280, 116);
        footer.lineStyle(1, 0xe6cddd, 0.45).lineBetween(32, 684, 1244, 684);
        this.selection = this.label(36, 703, '', 22, '#f5e4be');
        this.detail = this.label(36, 740, '', 16, '#d7b7c6').setWordWrapWidth(850);
        this.play = this.add.text(1238, 714, 'PLAY', {
            fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#321a27',
            backgroundColor: '#ebcd62', padding: { x: 28, y: 17 }
        }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
        this.play.on('pointerdown', () => {
            if (this.selected.playable && isUnlocked(this.selected.id)) {
                this.scene.start('CatPhysicsScene', { levelId: this.selected.id });
            }
        });
        const inList = pointer => pointer.y >= TOP && pointer.y < TOP + HEIGHT && pointer.x >= 28 && pointer.x < 1230;
        let gesture = null;
        const onWheel = (pointer, objects, dx, dy) => {
            if (inList(pointer)) this.scrollTo(this.scrollOffset + dy);
        };
        const onDown = pointer => {
            if (inList(pointer)) gesture = { y: pointer.y, offset: this.scrollOffset, moved: false };
        };
        const onMove = pointer => {
            if (!gesture || !pointer.isDown) return;
            if (Math.abs(pointer.y - gesture.y) > 8) gesture.moved = true;
            if (gesture.moved) this.scrollTo(gesture.offset + gesture.y - pointer.y);
        };
        const onUp = pointer => {
            if (gesture && !gesture.moved && inList(pointer)) {
                const index = Math.floor((pointer.y - TOP + this.scrollOffset) / ROW);
                if (LEVELS[index]) this.launchLevel(LEVELS[index]);
            }
            gesture = null;
        };
        const onOutside = () => { gesture = null; };
        const handlers = { wheel: onWheel, pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointerupoutside: onOutside };
        Object.entries(handlers).forEach(([event, handler]) => this.input.on(event, handler));
        this.events.once('shutdown', () => {
            Object.entries(handlers).forEach(([event, handler]) => this.input.off(event, handler));
            this.list.clearMask(true);
            clip.destroy();
        });
        this.scrollTo(0);
        this.selectLevel(LEVELS[0]);
    }

    label(x, y, text, size, color = '#fff1f0') {
        return this.add.text(x, y, text, { fontFamily: 'Arial', fontSize: `${size}px`, color });
    }

    heading(x, y, text, size, color = '#fff1f0') {
        return this.add.text(x, y, text, {
            fontFamily: '"Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif',
            fontSize: `${size}px`, color, stroke: '#261224', strokeThickness: 2,
            shadow: { offsetX: 2, offsetY: 3, color: '#1b0b20', blur: 3, fill: true }
        }).setScale(0.72, 1).setLetterSpacing(3);
    }

    createRow(level, index) {
        const unlocked = isUnlocked(level.id);
        const completed = isCompleted(level.id);
        const row = this.add.container(0, index * ROW);
        const panel = this.add.graphics();
        const title = this.heading(226, 22, level.title.toUpperCase(), 48);
        if (title.displayWidth > 700) title.setScale(700 / title.width, 1);
        const number = this.label(113, 83, String(level.id).padStart(2, '0'), 33).setOrigin(0.5);
        number.setStyle({ fontFamily: 'monospace', fontStyle: 'bold', stroke: '#291629', strokeThickness: 4 });
        const status = completed ? 'COMPLETED' : !unlocked ? `LOCKED · FINISH ${String(level.id - 1).padStart(2, '0')}` : level.playable ? 'READY TO PLAY' : 'COMING SOON';
        row.add([panel, title, number, this.label(228, 111, status, 21, unlocked ? '#ecdbbd' : '#ba97ad')]);
        const emblem = this.add.graphics();
        if (completed) {
            const points = Array.from({ length: 10 }, (_, i) => {
                const angle = -Math.PI / 2 + i * Math.PI / 5;
                const radius = i % 2 ? 23 : 48;
                return { x: 1132 + Math.cos(angle) * radius, y: 72 + Math.sin(angle) * radius };
            });
            emblem.fillStyle(0xecc63e).lineStyle(3, 0xffec94);
            emblem.fillPoints(points, true).strokePoints(points, true);
        } else if (!unlocked) {
            emblem.lineStyle(4, 0xaf879e).strokeRoundedRect(1116, 51, 32, 36, 15);
            emblem.fillStyle(0xaf879e).fillRoundedRect(1107, 73, 50, 37, 6);
            emblem.fillStyle(0x432039).fillCircle(1132, 89, 4).fillRect(1130, 89, 4, 10);
        } else {
            emblem.lineStyle(4, 0xe7dca5).beginPath().moveTo(1117, 57).lineTo(1141, 81).lineTo(1117, 105).strokePath();
        }
        row.add(emblem);
        this.list.add(row);
        this.rows.push({ level, panel });
    }

    scrollTo(offset) {
        const contentHeight = LEVELS.length * ROW;
        const max = Math.max(0, contentHeight - HEIGHT);
        this.scrollOffset = Phaser.Math.Clamp(offset, 0, max);
        this.list.y = TOP - this.scrollOffset;
        const thumbHeight = HEIGHT * Math.min(1, HEIGHT / contentHeight);
        const thumbY = TOP + (max ? this.scrollOffset / max : 0) * (HEIGHT - thumbHeight);
        this.scrollbar.clear().fillStyle(0xffffff, 0.1).fillRoundedRect(1248, TOP, 6, HEIGHT, 3);
        this.scrollbar.fillStyle(0xe6cddd, 0.65).fillRoundedRect(1248, thumbY, 6, thumbHeight, 3);
    }

    launchLevel(level) {
        if (!level || !isUnlocked(level.id)) return;
        this.scene.start('CatPhysicsScene', { levelId: level.id });
    }

    selectLevel(level) {
        if (!isUnlocked(level.id)) return;

        this.selected = level;
        this.rows.forEach(({ level: item, panel }) => {
            const selected = item.id === level.id;
            panel.clear();
            if (selected) panel.fillStyle(0xf5d8ee, 0.1).fillRect(32, 0, 1198, ROW);
            panel.lineStyle(2, 0xd4adbf, 0.4).lineBetween(32, ROW - 1, 1230, ROW - 1);
            panel.fillStyle(0x251023, 0.65).fillRoundedRect(40, 19, 146, 137, 28);
            panel.lineStyle(4, 0xf3e9ed, isUnlocked(item.id) ? 1 : 0.55).strokeRoundedRect(40, 19, 146, 137, 28);
            if (selected || isCompleted(item.id)) {
                panel.fillStyle(0xe9bf32).fillRoundedRect(51, 30, 124, 115, 19);
                panel.lineStyle(3, 0xffe68e).strokeRoundedRect(51, 30, 124, 115, 19);
                panel.fillStyle(0xfff4cc, 0.45).fillRoundedRect(57, 36, 112, 43, 12);
            }
        });
        this.selection.setText(`Level ${level.id} · ${level.title}`);
        const unlocked = isUnlocked(level.id);
        this.detail.setText(!unlocked ? `Complete Level ${level.id - 1} to unlock. ${level.description}` : !level.playable ? 'Gameplay for this level is coming soon.' : level.description);
        this.play.setVisible(unlocked && level.playable);
        this.play.setText(`PLAY LEVEL ${level.id}  →`);
    }
}
