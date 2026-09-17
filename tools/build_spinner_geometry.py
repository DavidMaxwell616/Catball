"""Trace spinner.png's alpha into simplified collision contours (requires Pillow)."""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
name = sys.argv[1] if len(sys.argv) > 1 else 'spinner'
if name not in ('spinner', 'windmill'):
    raise SystemExit('Choose spinner or windmill')
image = Image.open(ROOT / f'assets/images/{name}.png').convert('RGBA')
width, height = image.size
alpha = image.getchannel('A')
solid = {(x, y) for y in range(height) for x in range(width) if alpha.getpixel((x, y)) >= 128}
edges = defaultdict(set)
for x, y in solid:
    for neighbor, start, end in [
        ((x, y - 1), (x, y), (x + 1, y)),
        ((x + 1, y), (x + 1, y), (x + 1, y + 1)),
        ((x, y + 1), (x + 1, y + 1), (x, y + 1)),
        ((x - 1, y), (x, y + 1), (x, y)),
    ]:
        if neighbor not in solid:
            edges[start].add(end)


def area(points):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1])) / 2


def simplify(points, tolerance=2):
    if len(points) <= 2:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    distances = [abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / length
                 if length else math.dist(a, p) for p in points[1:-1]]
    maximum = max(distances, default=0)
    if maximum <= tolerance:
        return [a, b]
    split = distances.index(maximum) + 1
    return simplify(points[:split + 1], tolerance)[:-1] + simplify(points[split:], tolerance)


contours = []
while edges:
    start = min(edges)
    point = start
    contour = []
    while True:
        contour.append(point)
        end = min(edges[point])
        edges[point].remove(end)
        if not edges[point]:
            del edges[point]
        point = end
        if point == start:
            break
    if abs(area(contour)) > 200:
        # Split a closed ring at its farthest point before simplifying.
        split = max(range(len(contour)), key=lambda i: math.dist(contour[0], contour[i]))
        reduced = simplify(contour[:split + 1])[:-1] + simplify(contour[split:] + contour[:1])[:-1]
        contours.append(reduced)

contours.sort(key=lambda points: abs(area(points)), reverse=True)
assert len(contours) == (2 if name == 'spinner' else 1)
assert area(contours[0]) > 0
assert all(area(contour) < 0 for contour in contours[1:])
vertices = []
holes = []
for index, contour in enumerate(contours):
    if index:
        holes.append(len(vertices) // 2)
    for x, y in contour:
        vertices.extend([round(x / width - 0.5, 7), round(y / height - 0.5, 7)])
result = {'source': f'assets/images/{name}.png', 'vertices': vertices, 'holes': holes}
if name == 'windmill':
    result['aspectRatio'] = width / height
(ROOT / f'assets/{name}-geometry.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Traced {name}: {sum(map(len, contours))} vertices in {len(contours)} contours.')
