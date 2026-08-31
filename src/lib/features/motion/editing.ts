import { check, evaluate, type Layer, type Value } from './model';
import type { Operation } from './commands';
/** Seed the original pose when auto-key starts a previously unanimated track after frame zero. */
export function propertyEdits(
	layer: Layer,
	changes: Record<string, Value>,
	frame: number,
	autoKey: boolean
): Operation[] {
	const operations: Operation[] = [];
	for (const [property, value] of Object.entries(changes)) {
		const track = layer.tracks[property];
		check(track, `Unknown property ${property}`);
		if (autoKey && !track.keys.length && frame > 0)
			operations.push({
				name: 'add_keyframe',
				input: { layerId: layer.id, property, frame: 0, value: track.defaultValue }
			});
		operations.push({
			name: 'set_property',
			input: {
				layerId: layer.id,
				property,
				value,
				...(autoKey || track.keys.length ? { frame } : {})
			}
		});
	}
	return operations;
}
export function animationSegments(layer: Layer, property: string) {
	const track = layer.tracks[property];
	return track.keys.slice(0, -1).map((start, index) => ({
		id: start.id,
		start,
		end: track.keys[index + 1],
		property,
		layerId: layer.id
	}));
}
export function previewLayer(
	layer: Layer,
	preview: { layerId: string; values: Record<string, Value> } | null
): Layer {
	if (!preview || preview.layerId !== layer.id) return layer;
	return {
		...layer,
		tracks: {
			...layer.tracks,
			...Object.fromEntries(
				Object.entries(preview.values).map(([key, value]) => [
					key,
					{ defaultValue: value, keys: [] }
				])
			)
		}
	};
}
export function propertyStep(property: string) {
	return /scale|opacity|Opacity|^gradient\./.test(property) ? 0.01 : 1;
}
export function propertyBounds(property: string): [number, number] {
	if (
		property === 'opacity' ||
		property === 'paintOpacity' ||
		property.endsWith('.opacity') ||
		property.endsWith('.offset')
	)
		return [0, 1];
	if (property === 'scaleX' || property === 'scaleY') return [0.001, 100];
	if (['width', 'height', 'gradient.radius'].includes(property)) return [0.001, 10000];
	if (['cornerRadius', 'strokeWidth'].includes(property)) return [0, 10000];
	return [-1e6, 1e6];
}
export function numericValue(layer: Layer, property: string, frame: number) {
	return Number(evaluate(layer.tracks[property], frame));
}

/** Keep a moved segment ordered between its neighbors, without crossing or colliding. */
export function keyframeMoveBounds(
	layer: Layer,
	property: string,
	keyIds: string[],
	duration: number
): [number, number] {
	const keys = layer.tracks[property].keys;
	let min = -Infinity,
		max = Infinity;
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (!keyIds.includes(key.id)) continue;
		min = Math.max(min, -key.frame);
		max = Math.min(max, duration - 1 - key.frame);
		const previous = keys.slice(0, i).findLast((k) => !keyIds.includes(k.id));
		const next = keys.slice(i + 1).find((k) => !keyIds.includes(k.id));
		if (previous) min = Math.max(min, previous.frame + 1 - key.frame);
		if (next) max = Math.min(max, next.frame - 1 - key.frame);
	}
	return [min || 0, max || 0];
}
