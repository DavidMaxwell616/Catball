// A row of twelve vertical bars forming one moving obstacle.
export class Snake {
    constructor(scene, config) {
        this.scale = scene.SCALE;
        this.elapsed = 0;
        this.amplitude = config.amplitude ?? 180; // pixels above/below the resting center
        this.period = (config.duration ?? 4000) / 1000;
        this.width = config.segmentWidth ?? 30;
        const source = scene.textures.get('snake-segment').getSourceImage();
        this.height = this.width * source.height / source.width;
        this.baseY = config.y * scene.scale.height;
        this.segments = Array.from({ length: 12 }, (_, index) => {
            const x = config.x * scene.scale.width + (index - 5.5) * this.width;
            const phase = -index * Math.PI * 2 / 12;
            const y = this.baseY + this.amplitude * Math.sin(phase);
            const sprite = scene.add.image(x, y, 'snake-segment')
                .setDisplaySize(this.width, this.height).setDepth(0);
            const body = scene.world.createKinematicBody({
                position: planck.Vec2(x / this.scale, y / this.scale)
            });
            body.createFixture(planck.Box(this.width / 2 / this.scale, this.height / 2 / this.scale), {
                friction: 0.7, restitution: 0.15
            });
            return { sprite, body, phase };
        });
    }

    step(dt) {
        this.elapsed = (this.elapsed + dt) % this.period;
        for (const { body, phase } of this.segments) {
            const y = this.baseY + this.amplitude * Math.sin(this.elapsed * Math.PI * 2 / this.period + phase);
            // Drive the body with velocity so contacts transfer motion to the ball.
            body.setLinearVelocity(planck.Vec2(0, (y / this.scale - body.getPosition().y) / dt));
        }
    }

    sync() {
        for (const { sprite, body } of this.segments) {
            const position = body.getPosition();
            sprite.setPosition(position.x * this.scale, position.y * this.scale);
        }
    }

    drawDebug(graphics) {
        for (const { body } of this.segments) {
            const position = body.getPosition();
            graphics.strokeRect(position.x * this.scale - this.width / 2,
                position.y * this.scale - this.height / 2, this.width, this.height);
        }
    }
}
