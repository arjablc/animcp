import { check, evaluate, propertyBounds, type Layer, type Value } from './model';
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
		const existingKey = track.keys.some((key) => key.frame === frame);
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
				...(autoKey || existingKey
					? { frame }
					: track.keys.length
						? { trackEdit: true, referenceFrame: frame }
						: {})
			}
		});
	}
	return operations;
}

/** Resolve Delete without allowing a held key to change targets after reconciliation. */
export function deleteShortcutAction(
	selectedKeyframeIds: string[],
	selectedLayerIds: string[],
	selectedProperties: string[],
	repeated: boolean
): 'keyframes' | 'layers' | null {
	if (repeated) return null;
	if (selectedKeyframeIds.length) return 'keyframes';
	if (selectedLayerIds.length && !selectedProperties.length) return 'layers';
	return null;
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
	return /scale|opacity|Opacity|^draw(Start|End)$|^gradient\./.test(property) ? 0.01 : 1;
}
export { propertyBounds } from './model';
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
