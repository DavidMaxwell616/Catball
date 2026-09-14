// Cat identity selects a role; color only selects artwork and hint text.
export function resolveCatRoles(level) {
    const keys = Object.keys(level.cats);
    const sourceKey = level.sourceCat ?? keys.find(key => key !== (level.targetCat ?? 'white'));
    const targetKey = level.targetCat ?? keys.find(key => key !== sourceKey);
    if (!level.cats[sourceKey] || !level.cats[targetKey] || sourceKey === targetKey) {
        throw new Error('A level must have distinct source and target cats');
    }
    return { sourceKey, targetKey };
}

export function catGeometry(key, cat, other, spawn) {
    const side = cat.tailSide ?? (spawn && spawn.x !== cat.x
        ? Math.sign(spawn.x - cat.x) : (Math.sign(other.x - cat.x) || 1));
    const tail = {
        x: cat.x + (side < 0 ? -0.06 : 0.018),
        y: cat.groundY + 0.008,
        width: 0.043,
        height: 0.066,
        flipX: side > 0,
        ...cat.tail
    };
    const patch = {
        x: tail.x + (tail.flipX ? 0 : 0.007),
        y: tail.y - tail.height,
        width: 0.042,
        height: 0.065,
        sampleX: tail.x + (tail.flipX ? 0.045 : -0.045),
        ...tail.patch
    };
    return {
        ...cat, key, color: cat.color ?? key, tail: { ...tail, patch },
        direction: tail.flipX ? 1 : -1,
        catchPoint: {
            x: tail.x + tail.width * (tail.flipX ? 50 : 80) / 130,
            y: tail.y - tail.height * 0.59
        }
    };
}
