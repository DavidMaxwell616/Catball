// Cat identity selects a role; color only selects artwork and hint text.
export function resolveCatRoles(level) {
    const keys = Object.keys(level.cats);
    const sourceKey = level.sourceCat ?? keys.find(key => !(level.targetCats ?? [level.targetCat ?? 'white']).includes(key));
    const targetKeys = level.targetCats ?? [level.targetCat ?? keys.find(key => key !== sourceKey)];
    const targetKey = targetKeys[0];
    if (!level.cats[sourceKey] || !targetKeys.length || targetKeys.some(key => !level.cats[key] || sourceKey === key)) {
        throw new Error('A level must have distinct source and target cats');
    }
    return { sourceKey, targetKey, targetKeys };
}

export function catGeometry(key, cat, other, spawn) {
    const side = cat.tailSide ?? (spawn && spawn.x !== cat.x
        ? Math.sign(spawn.x - cat.x) : (Math.sign(other.x - cat.x) || 1));
    const tail = {
        width: 0.043,
        height: 0.066,
        flipX: side > 0,
        ...cat.tail
    };
    // Match the ball's 1.5x display scale so it fits inside the resting curl.
    tail.width *= 1.5;
    tail.height *= 1.5;
    // The cropped frames join the body at (125, 80) in a 130 x 100 frame.
    // Overlap the body's lower flank so transparent frame padding cannot leave a gap.
    const attachmentX = cat.x + (tail.flipX ? 0.014 : -0.014);
    const attachmentY = cat.groundY - 0.012;
    tail.x = attachmentX - tail.width * (tail.flipX ? 5 : 125) / 130;
    tail.y = attachmentY + tail.height * 0.2;
    return {
        ...cat, key, color: cat.color ?? key, tail,
        direction: tail.flipX ? 1 : -1,
        catchPoint: {
            x: tail.x + tail.width * (tail.flipX ? 50 : 80) / 130,
            y: tail.y - tail.height * 0.59
        }
    };
}
