import { Control, Point, util, type Path, type TMat2D } from 'fabric';

/** Matrix that acts on canonical path coordinates, not Fabric's centered coordinates. */
export function pathMatrix(path: Path): TMat2D {
	const m = path.calcTransformMatrix();
	return [
		m[0],
		m[1],
		m[2],
		m[3],
		m[4] - m[0] * path.pathOffset.x - m[2] * path.pathOffset.y,
		m[5] - m[1] * path.pathOffset.x - m[3] * path.pathOffset.y
	];
}

/** Keep world-space geometry stable when path edits change Fabric's bounding box. */
export function preservePathMatrix(path: Path, matrix: TMat2D) {
	path.setDimensions();
	path.set({
		left: matrix[4] + matrix[0] * path.pathOffset.x + matrix[2] * path.pathOffset.y,
		top: matrix[5] + matrix[1] * path.pathOffset.x + matrix[3] * path.pathOffset.y,
		dirty: true
	});
	path.setCoords();
}

export function createEditorPathControls(path: Path, onselect: (index: number) => void) {
	const controls: Record<string, Control> = {};
	path.path.forEach((command, index) => {
		if (command[0] === 'Z') return;
		const positions = command[0] === 'C' ? [1, 3, 5] : [1];
		for (const offset of positions) {
			const handle = command[0] === 'C' && offset !== 5;
			controls[`${index}_${offset}`] = new Control({
				actionName: 'modifyPath',
				cursorStyle: 'crosshair',
				sizeX: 12,
				sizeY: 12,
				positionHandler: (_dim, _matrix, object) => {
					const target = object as Path;
					const cmd = target.path[index];
					return new Point(cmd[offset] as number, cmd[offset + 1] as number)
						.transform(pathMatrix(target))
						.transform(target.getViewportTransform());
				},
				mouseDownHandler: () => {
					onselect(index);
					return true;
				},
				actionHandler: (_event, transform, x, y) => {
					const target = transform.target as Path;
					const matrix = pathMatrix(target);
					const point = new Point(x, y).transform(util.invertTransform(matrix));
					target.path[index][offset] = point.x;
					target.path[index][offset + 1] = point.y;
					preservePathMatrix(target, matrix);
					return true;
				},
				render: (ctx, left, top, _override, object) => {
					ctx.save();
					ctx.strokeStyle = '#91a4ae';
					ctx.fillStyle = handle ? '#101c26' : '#dfff4f';
					ctx.lineWidth = 1.5;
					if (handle) {
						const target = object as Path;
						const previous = target.path[Math.max(0, index - 1)];
						const anchor = offset === 1 ? previous : target.path[index];
						const end = anchor.length - 2;
						if (anchor[0] !== 'Z') {
							const p = new Point(anchor[end] as number, anchor[end + 1] as number)
								.transform(pathMatrix(target))
								.transform(target.getViewportTransform());
							ctx.beginPath();
							ctx.moveTo(left, top);
							ctx.lineTo(p.x, p.y);
							ctx.stroke();
						}
					}
					ctx.beginPath();
					ctx.arc(left, top, handle ? 4 : 5, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
					ctx.restore();
				}
			});
		}
	});
	return controls;
}
