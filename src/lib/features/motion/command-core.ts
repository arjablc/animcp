import {
	check,
	evaluate,
	number,
	propertyBounds,
	presets,
	type Easing,
	type Key,
	type Layer,
	type Project,
	type Track,
	type Value,
	uid,
	validateEasing
} from './model';

export type Input = Record<string, unknown>;
export type Operation = { name: string; input: Input };
export type Context = {
	currentFrame: number;
	selectedLayerIds: string[];
	selectedKeyframeIds: string[];
	selectedProperties: string[];
	selectedRange: { startFrame: number; endFrame: number } | null;
	revision: number;
};
export type History = { label: string; actor: 'human' | 'agent'; before: Project; after: Project };

export const unhandled = Symbol('unhandled command');

export function layerById(p: Project, id: unknown): Layer {
	const l = p.layers.find((l) => l.id === id);
	check(l, 'Layer not found');
	return l;
}

export function editable(p: Project, id: unknown): Layer {
	const l = layerById(p, id);
	check(!l.locked, `Layer “${l.name}” is locked`);
	return l;
}

export function strings(v: unknown): string[] {
	check(
		Array.isArray(v) && v.every((s) => typeof s === 'string'),
		'Expected an array of IDs/properties'
	);
	return v;
}

export function put(t: Track, frame: number, value: Value, easing?: Easing) {
	const old = t.keys.find((k) => k.frame === frame);
	if (old) {
		old.value = value;
		if (easing) old.easing = structuredClone(easing);
	} else
		t.keys.push({ id: uid(), frame, value, easing: structuredClone(easing ?? presets.linear) });
	t.keys.sort((a, b) => a.frame - b.frame);
}

export function editWholeTrack(t: Track, property: string, frame: number, target: Value) {
	const current = evaluate(t, frame);
	if (typeof target !== 'number' || typeof current !== 'number') {
		t.defaultValue = target;
		for (const key of t.keys) key.value = target;
		return;
	}
	const [min, max] = propertyBounds(property);
	const bounded =
		property === 'opacity' ||
		property === 'paintOpacity' ||
		property === 'drawStart' ||
		property === 'drawEnd' ||
		property === 'scaleX' ||
		property === 'scaleY' ||
		['width', 'height', 'gradient.radius', 'cornerRadius', 'strokeWidth'].includes(property) ||
		property.endsWith('.opacity') ||
		property.endsWith('.offset');
	const map = (raw: Value) => {
		const value = Number(raw);
		if (bounded && target < current && current > min)
			return min + (value - min) * ((target - min) / (current - min));
		if (bounded && target > current && current < max)
			return max - (max - value) * ((max - target) / (max - current));
		return value + target - current;
	};
	t.defaultValue = map(t.defaultValue);
	for (const key of t.keys) key.value = map(key.value);
}

export function easing(input: Input): Easing {
	const e = typeof input.preset === 'string' ? presets[input.preset] : (input.easing as Easing);
	check(e, 'Unknown easing preset');
	validateEasing(e);
	return structuredClone(e);
}

type Ref = { layer: Layer; property: string; track: Track; keys: Key[] };

export function refs(p: Project, input: Input, readOnly = false): Ref[] {
	const ids = strings(input.layerIds);
	check(ids.length > 0, 'Select at least one layer');
	check(new Set(ids).size === ids.length, 'Duplicate target layer');
	const properties = input.properties === undefined ? null : strings(input.properties);
	const keyIds = input.keyframeIds === undefined ? null : strings(input.keyframeIds);
	let range: { startFrame: number; endFrame: number } | undefined;
	if (input.range !== undefined) {
		range = input.range as typeof range;
		check(range, 'Invalid range');
		number(range.startFrame, 0);
		number(range.endFrame, range.startFrame);
	}
	const result: Ref[] = [];
	for (const id of ids) {
		const l = readOnly ? layerById(p, id) : editable(p, id);
		if (properties)
			for (const property of properties)
				check(l.tracks[property], `Property ${property} is unavailable on ${l.name}`);
		for (const [property, t] of Object.entries(l.tracks)) {
			if (properties && !properties.includes(property)) continue;
			const keys = t.keys.filter(
				(k) =>
					(!range || (k.frame >= range.startFrame && k.frame <= range.endFrame)) &&
					(!keyIds || keyIds.includes(k.id))
			);
			if (keys.length) result.push({ layer: l, property, track: t, keys });
		}
	}
	check(result.length, 'No matching animated properties');
	return result;
}

export function span(rs: Ref[]) {
	const frames = rs.flatMap((r) => r.keys.map((k) => k.frame));
	check(frames.length, 'No animation span');
	return { start: Math.min(...frames), end: Math.max(...frames) };
}

export function shift(rs: Ref[], delta: number) {
	for (const r of rs) for (const k of r.keys) k.frame += delta;
}

export function validateLocks(before: Project, after: Project, preserve?: Input) {
	for (const l of before.layers) {
		const next = after.layers.find((n) => n.id === l.id);
		// Lock toggles are allowed, but a locked layer's content must remain byte-for-byte equivalent.
		if (l.locked && next)
			check(
				JSON.stringify({ ...l, locked: next.locked }) === JSON.stringify(next),
				`Layer “${l.name}” is locked`
			);
		if (l.locked && !next) throw new Error(`Layer “${l.name}” is locked`);
		for (const [prop, t] of Object.entries(l.tracks)) {
			const locks: Record<string, unknown> = { ...t.locks };
			for (const [key, enabled] of Object.entries(preserve ?? {}))
				locks[key] = locks[key] || enabled;
			if (!Object.values(locks).some(Boolean)) continue;
			const nt = next?.tracks[prop];
			check(nt, `Protected track ${prop} cannot be removed`);
			const a = t.keys[0],
				b = t.keys.at(-1),
				c = nt.keys[0],
				d = nt.keys.at(-1);
			for (const [name, enabled] of Object.entries(locks)) {
				if (!enabled) continue;
				if (name === 'startFrame') check(a?.frame === c?.frame, 'Start frame is protected');
				if (name === 'endFrame') check(b?.frame === d?.frame, 'End frame is protected');
				if (name === 'duration')
					check(
						(a && b ? b.frame - a.frame : 0) === (c && d ? d.frame - c.frame : 0),
						'Duration is protected'
					);
				if (name === 'startValue')
					check(
						(a?.value ?? t.defaultValue) === (c?.value ?? nt.defaultValue),
						'Start value is protected'
					);
				if (name === 'endValue')
					check(
						(b?.value ?? t.defaultValue) === (d?.value ?? nt.defaultValue),
						'Final value is protected'
					);
				if (name === 'easing')
					check(
						JSON.stringify(t.keys.map((k) => k.easing)) ===
							JSON.stringify(nt.keys.map((k) => k.easing)),
						'Easing is protected'
					);
			}
		}
	}
}
