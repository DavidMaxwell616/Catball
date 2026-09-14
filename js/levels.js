export const LEVELS = [
    ['Pass the Ball', 'A simple pass straight across. Get familiar with directional throwing.'],
    ['Move the Arrow', 'Adjust directional guides to change the ball’s path.'],
    ['Race Track', 'Roll the ball along open pathways toward the target cat.'],
    ['Introducing Buttons', 'Hit switches to trigger changes in the environment.'],
    ['Flip It', 'Combine basic angles and walls to complete structural passes.'],
    ['Teleporters', 'Master tighter timing and clear obstacles to reach the catching cat.'],
    ['Shredders', 'Find sharp, precise bounce angles in close quarters.'],
    ['Timing is Key', 'Release at just the right moment to pass moving parts.'],
    ['Aim for Success', 'Choose your path and aim accurately for the destination.'],
    ['Any Cat', 'Use strategic redirection to solve a complex layout.']
].map(([title, description], index) => ({ id: index + 1, title, description, playable: true }));

const KEY = 'cat-physics-completed';
let completed = [];
try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) completed = saved.filter(id => Number.isInteger(id) && id >= 1 && id <= LEVELS.length);
} catch { /* Progress remains available in memory when storage is unavailable. */ }
export const isCompleted = id => completed.includes(id);
export const isUnlocked = id => id === 1 || isCompleted(id - 1);
export function completeLevel(id) {
    if (!LEVELS.some(level => level.id === id && level.playable) || !isUnlocked(id)) return;
    if (!completed.includes(id)) completed.push(id);
    try { localStorage.setItem(KEY, JSON.stringify(completed)); } catch { /* Keep session progress. */ }
}
