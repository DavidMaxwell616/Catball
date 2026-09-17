// x/y locate the base of the fulcrum in normalized level coordinates.
export class Seesaw {
    constructor(scene, position) {
        this.fulcrum = scene.createBump(position);
        const image = scene.textures.get('teeter-totter').getSourceImage();
        const width = 0.24 * Math.min(scene.scale.width, scene.scale.height);
        const height = width * image.height / image.width;
        const x = position.x * scene.scale.width;
        const y = position.y * scene.scale.height - 0.043 * scene.scale.height - height / 2;
        this.sprite = scene.add.image(x, y, 'teeter-totter')
            .setDisplaySize(width, height).setDepth(0);
        this.body = scene.world.createDynamicBody({
            position: planck.Vec2(x / scene.SCALE, y / scene.SCALE),
            angularDamping: 0.35
        });
        this.body.createFixture(planck.Box(width / 2 / scene.SCALE, height / 2 / scene.SCALE), {
            density: 0.5, friction: 0.85, restitution: 0.1
        });
        this.joint = scene.world.createJoint(planck.RevoluteJoint({
            enableMotor: false, enableLimit: true,
            lowerAngle: -Math.PI / 9, upperAngle: Math.PI / 9,
            collideConnected: false
        }, this.fulcrum.body, this.body, this.body.getPosition()));
        // Establish the joint's horizontal reference before applying the starting tilt.
        const startingAngle = -Math.PI / 12;
        this.body.setTransform(this.body.getPosition(), startingAngle);
        this.sprite.rotation = startingAngle;
        this.contour = [[-width / 2, -height / 2], [width / 2, -height / 2],
            [width / 2, height / 2], [-width / 2, height / 2]]
            .map(([px, py]) => planck.Vec2(px / scene.SCALE, py / scene.SCALE));
        this.scale = scene.SCALE;
    }

    sync() {
        const position = this.body.getPosition();
        this.sprite.setPosition(position.x * this.scale, position.y * this.scale);
        this.sprite.rotation = this.body.getAngle();
    }

    drawDebug(graphics) {
        graphics.strokePoints(this.fulcrum.points, true);
        graphics.strokePoints(this.contour.map(point => {
            const world = this.body.getWorldPoint(point);
            return { x: world.x * this.scale, y: world.y * this.scale };
        }), true);
    }
}
