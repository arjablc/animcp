import { value, type Layer, type Project } from './model';

type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };
type TransformBox = {
	positionX: number;
	positionY: number;
	width: number;
	height: number;
	rotation: number;
};

export function rotatePoint(point: Point, center: Point, degrees: number) {
	const radians = (degrees * Math.PI) / 180;
	const dx = point.x - center.x,
		dy = point.y - center.y;
	return {
		x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
		y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians)
	};
}

export function localPoint(point: Point, base: TransformBox) {
	const center = {
		x: base.positionX + base.width / 2,
		y: base.positionY + base.height / 2
	};
	const unrotated = rotatePoint(point, center, -base.rotation);
	return { x: unrotated.x - base.positionX, y: unrotated.y - base.positionY };
}

export function layerBounds(layer: Layer, frame: number): Bounds {
	return {
		x: value(layer, 'positionX', frame),
		y: value(layer, 'positionY', frame),
		width: Math.max(0.001, value(layer, 'width', frame) * value(layer, 'scaleX', frame)),
		height: Math.max(0.001, value(layer, 'height', frame) * value(layer, 'scaleY', frame))
	};
}

function visualBounds(layer: Layer, frame: number): Bounds {
	const x = value(layer, 'positionX', frame),
		y = value(layer, 'positionY', frame),
		width = Math.max(0.001, value(layer, 'width', frame)),
		height = Math.max(0.001, value(layer, 'height', frame)),
		scaleX = value(layer, 'scaleX', frame),
		scaleY = value(layer, 'scaleY', frame),
		rotation = (value(layer, 'rotation', frame) * Math.PI) / 180,
		center = { x: x + width / 2, y: y + height / 2 };
	const corners = [
		{ x, y },
		{ x: x + width, y },
		{ x: x + width, y: y + height },
		{ x, y: y + height }
	].map((corner) => {
		const dx = (corner.x - center.x) * scaleX,
			dy = (corner.y - center.y) * scaleY;
		return {
			x: center.x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
			y: center.y + dx * Math.sin(rotation) + dy * Math.cos(rotation)
		};
	});
	const left = Math.min(...corners.map((corner) => corner.x)),
		top = Math.min(...corners.map((corner) => corner.y)),
		right = Math.max(...corners.map((corner) => corner.x)),
		bottom = Math.max(...corners.map((corner) => corner.y));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function selectionBounds(project: Project, layer: Layer, frame: number): Bounds {
	if (layer.type !== 'group')
		return {
			x: 0,
			y: 0,
			width: Math.max(0.001, value(layer, 'width', frame)),
			height: Math.max(0.001, value(layer, 'height', frame))
		};
	const children = project.layers.filter((child) => child.parentId === layer.id && child.visible);
	if (!children.length)
		return {
			x: 0,
			y: 0,
			width: Math.max(0.001, value(layer, 'width', frame)),
			height: Math.max(0.001, value(layer, 'height', frame))
		};
	const childBounds = children.map((child) => visualBounds(child, frame));
	const left = Math.min(...childBounds.map((child) => child.x)),
		top = Math.min(...childBounds.map((child) => child.y)),
		right = Math.max(...childBounds.map((child) => child.x + child.width)),
		bottom = Math.max(...childBounds.map((child) => child.y + child.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

export function intersects(a: Bounds, b: Bounds) {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
