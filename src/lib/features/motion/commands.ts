import {
	addStop,
	check,
	createLayer,
	evaluate,
	number,
	presets,
	setGradient,
	string,
	uid,
	validateEasing,
	validateProject,
	type Easing,
	type Key,
	type Layer,
	type Project,
	type Track,
	type Value
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
export function layerById(p: Project, id: unknown): Layer {
	const l = p.layers.find((l) => l.id === id);
	check(l, 'Layer not found');
	return l;
}
function editable(p: Project, id: unknown): Layer {
	const l = layerById(p, id);
	check(!l.locked, `Layer “${l.name}” is locked`);
	return l;
}
function strings(v: unknown): string[] {
	check(
		Array.isArray(v) && v.every((s) => typeof s === 'string'),
		'Expected an array of IDs/properties'
	);
	return v;
}
function put(t: Track, frame: number, value: Value, easing?: Easing) {
	const old = t.keys.find((k) => k.frame === frame);
	if (old) {
		old.value = value;
		if (easing) old.easing = structuredClone(easing);
	} else
		t.keys.push({ id: uid(), frame, value, easing: structuredClone(easing ?? presets.linear) });
	t.keys.sort((a, b) => a.frame - b.frame);
}
function easing(input: Input): Easing {
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
function shift(rs: Ref[], delta: number) {
	for (const r of rs) for (const k of r.keys) k.frame += delta;
}
function locked(before: Project, after: Project, preserve?: Input) {
	for (const l of before.layers) {
		const next = after.layers.find((n) => n.id === l.id);
		// Layer lock/unlock is a deliberate command; content stays protected.
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
function apply(p: Project, op: Operation): unknown {
	const i = op.input;
	switch (op.name) {
		case 'rename_project':
			p.name = string(i.name, 200);
			return;
		case 'set_composition': {
			const allowed = ['width', 'height', 'fps', 'durationFrames', 'background'];
			check(
				Object.keys(i).every((k) => allowed.includes(k)),
				'Unknown composition setting'
			);
			Object.assign(p.composition, i);
			return;
		}
		case 'create_layer': {
			const l = createLayer(
				i.type as Layer['type'],
				i.name === undefined ? String(i.type) : string(i.name, 200)
			);
			if (i.text !== undefined) l.text = string(i.text, 10000);
			if (i.fontFamily !== undefined) l.fontFamily = string(i.fontFamily, 200);
			if (i.assetId !== undefined) {
				l.assetId = string(i.assetId);
				const a = p.assets.find((a) => a.id === l.assetId);
				check(a, 'Import the asset first');
				l.tracks.width.defaultValue = a.width;
				l.tracks.height.defaultValue = a.height;
			}
			p.layers.push(l);
			return { layerId: l.id };
		}
		case 'import_asset': {
			const a = i.asset as Project['assets'][number];
			check(a, 'Missing asset');
			p.assets.push(structuredClone(a));
			const l = createLayer(a.mime === 'image/png' ? 'png' : 'svg', a.name);
			l.assetId = a.id;
			const scale = Math.min(
				1,
				(p.composition.width * 0.7) / a.width,
				(p.composition.height * 0.7) / a.height
			);
			l.tracks.width.defaultValue = a.width * scale;
			l.tracks.height.defaultValue = a.height * scale;
			l.tracks.positionX.defaultValue = (p.composition.width - a.width * scale) / 2;
			l.tracks.positionY.defaultValue = (p.composition.height - a.height * scale) / 2;
			p.layers.push(l);
			return { layerId: l.id };
		}
		case 'duplicate_layer': {
			const l = structuredClone(layerById(p, i.layerId));
			l.id = uid();
			l.name += ' copy';
			l.locked = false;
			for (const t of Object.values(l.tracks)) for (const k of t.keys) k.id = uid();
			const old = l.paint.stops;
			l.paint.stops = old.map(() => uid());
			for (const [index, id] of old.entries())
				for (const suffix of ['color', 'offset', 'opacity']) {
					l.tracks[`gradient.stop.${l.paint.stops[index]}.${suffix}`] =
						l.tracks[`gradient.stop.${id}.${suffix}`];
					delete l.tracks[`gradient.stop.${id}.${suffix}`];
				}
			p.layers.push(l);
			return { layerId: l.id };
		}
		case 'delete_layer': {
			editable(p, i.layerId);
			p.layers = p.layers.filter((l) => l.id !== i.layerId);
			return;
		}
		case 'set_layer': {
			const l = layerById(p, i.layerId);
			const changes = i.changes as Input;
			check(changes && typeof changes === 'object', 'Missing changes');
			for (const [key, v] of Object.entries(changes)) {
				check(
					[
						'name',
						'visible',
						'locked',
						'text',
						'fontFamily',
						'fontWeight',
						'fontStyle',
						'fontSize',
						'lineHeight',
						'letterSpacing'
						,'textAlign'
					].includes(key),
					'Unsupported layer field'
				);
				if (key !== 'locked') check(!l.locked, 'Layer is locked');
				Object.assign(l, { [key]: v });
			}
			return;
		}
		case 'reorder_layer': {
			const l = editable(p, i.layerId);
			const index = number(i.index, 0, p.layers.length - 1);
			check(Number.isInteger(index), 'Invalid index');
			p.layers = p.layers.filter((n) => n.id !== l.id);
			p.layers.splice(index, 0, l);
			return;
		}
		case 'set_property':
		case 'add_keyframe': {
			const l = editable(p, i.layerId),
				property = string(i.property),
				t = l.tracks[property];
			check(t, 'Property not found');
			const v = i.value === undefined ? evaluate(t, number(i.frame, 0)) : (i.value as Value);
			if (op.name === 'add_keyframe' || i.frame !== undefined)
				put(t, number(i.frame, 0), v, i.easing ? easing(i) : undefined);
			else {
				check(!t.keys.length, 'Animated property requires an explicit frame');
				t.defaultValue = v;
			}
			return;
		}
		case 'set_paint': {
			const l = editable(p, i.layerId);
			check(l.type !== 'svg' && l.type !== 'png', 'Imported artwork paint is immutable');
			setGradient(l, i.type as Layer['paint']['type']);
			return;
		}
		case 'add_gradient_stop': {
			const l = editable(p, i.layerId);
			check(l.paint.type !== 'solid', 'Choose a gradient first');
			return { stopId: addStop(l, number(i.offset, 0, 1), string(i.color)) };
		}
		case 'delete_gradient_stop': {
			const l = editable(p, i.layerId);
			check(l.paint.stops.includes(String(i.stopId)), 'Stop not found');
			check(l.paint.stops.length > 2, 'Keep at least two stops');
			l.paint.stops = l.paint.stops.filter((id) => id !== i.stopId);
			for (const suffix of ['color', 'offset', 'opacity'])
				delete l.tracks[`gradient.stop.${i.stopId}.${suffix}`];
			return;
		}
		case 'set_motion_locks': {
			const l = editable(p, i.layerId);
			const t = l.tracks[string(i.property)];
			check(t, 'Property not found');
			t.locks = { ...t.locks, ...(i.locks as Track['locks']) };
			return;
		}
		case 'delete_keyframes':
		case 'move_keyframes':
		case 'duplicate_keyframes': {
			const ids = strings(i.keyframeIds);
			check(ids.length, 'Select keys');
			let count = 0;
			for (const l of p.layers)
				for (const t of Object.values(l.tracks)) {
					const selected = t.keys.filter((k) => ids.includes(k.id));
					if (!selected.length) continue;
					editable(p, l.id);
					count += selected.length;
					if (op.name === 'delete_keyframes') t.keys = t.keys.filter((k) => !ids.includes(k.id));
					else {
						const delta = number(i.frames);
						if (op.name === 'duplicate_keyframes')
							t.keys.push(
								...selected.map((k) => ({
									...structuredClone(k),
									id: uid(),
									frame: k.frame + delta
								}))
							);
						else for (const k of selected) k.frame += delta;
					}
				}
			check(count === new Set(ids).size, 'One or more keyframes no longer exist');
			return;
		}
		case 'set_easing':
		case 'copy_easing': {
			const rs = refs(p, i);
			let e: Easing;
			if (op.name === 'copy_easing') {
				const key = p.layers
					.flatMap((l) => Object.values(l.tracks).flatMap((t) => t.keys))
					.find((k) => k.id === i.sourceKeyframeId);
				check(key, 'Source keyframe not found');
				e = key.easing;
			} else e = easing(i);
			for (const r of rs) for (const k of r.keys) k.easing = structuredClone(e);
			return;
		}
		case 'copy_motion': {
			const source = layerById(p, i.sourceLayerId),
				props = strings(i.properties),
				targets = strings(i.targetLayerIds);
			check(props.length && targets.length, 'Choose properties and targets');
			check(!targets.includes(source.id), 'Source cannot also be a target');
			const sourceFrame = number(i.sourceFrame ?? 0, 0),
				targetFrame = number(i.targetFrame ?? 0, 0);
			check(i.mode === 'relative' || i.mode === 'absolute', 'Choose relative or absolute copy');
			for (const id of targets) {
				const target = editable(p, id);
				for (const prop of props) {
					const st = source.tracks[prop],
						tt = target.tracks[prop];
					check(st && tt, 'Copy needs matching property paths');
					check(st.keys.length, 'Source property has no motion');
					const baseline = evaluate(tt, targetFrame),
						sourceBase = evaluate(st, sourceFrame);
					check(
						i.mode !== 'relative' || typeof sourceBase === 'number',
						'Relative color copy is unsupported'
					);
					if (i.includeTiming === false)
						check(
							tt.keys.length === st.keys.length,
							'Timing-preserving copy requires equal key counts'
						);
					const old = structuredClone(tt.keys);
					tt.keys = st.keys.map((k, index) => {
						const value =
							i.mode === 'relative'
								? Number(baseline) + Number(k.value) - Number(sourceBase)
								: k.value;
						return {
							id: uid(),
							frame:
								i.includeTiming === false ? old[index].frame : k.frame - sourceFrame + targetFrame,
							value,
							easing: structuredClone(
								i.includeEasing === false ? (old[index]?.easing ?? presets.linear) : k.easing
							)
						};
					});
				}
			}
			return;
		}
		case 'sequence_motion': {
			const targetIds = strings(i.layerIds);
			check(!targetIds.includes(String(i.referenceLayerId)), 'Reference cannot be a target');
			const ref = refs(
				p,
				{
					layerIds: [i.referenceLayerId],
					properties: i.referenceProperties ?? i.properties,
					range: i.referenceRange ?? i.range
				},
				true
			);
			const refSpan = span(ref);
			// An explicit range identifies an entrance when a composition has more than one motion.
			check(
				i.referenceRange || i.range || ref.every((r) => r.keys.length === 2),
				'Reference has an ambiguous motion span; supply referenceRange'
			);
			const rs = refs(p, i);
			check(
				i.range || rs.every((r) => r.keys.length === 2),
				'Target has an ambiguous motion span; supply range'
			);
			const anchor = i.anchor ?? 'end';
			check(anchor === 'end' || anchor === 'start', 'Invalid sequence anchor');
			const gap = number(i.gapFrames ?? 1, 0);
			shift(rs, (anchor === 'start' ? refSpan.start : refSpan.end) + gap - span(rs).start);
			return;
		}
		case 'shift_motion':
		case 'stagger_motion':
		case 'align_keyframes':
		case 'retime_motion':
		case 'reverse_motion':
		case 'add_overshoot':
		case 'add_anticipation':
		case 'distribute_timing':
		case 'normalize_motion': {
			const rs = refs(p, i),
				s = span(rs);
			if (op.name === 'shift_motion') {
				shift(rs, number(i.frames));
				return;
			}
			if (
				op.name === 'stagger_motion' ||
				op.name === 'distribute_timing' ||
				op.name === 'align_keyframes'
			) {
				const ids = strings(i.layerIds);
				for (const [index, id] of ids.entries()) {
					const group = rs.filter((r) => r.layer.id === id);
					if (!group.length) continue;
					const gs = span(group);
					if (op.name === 'stagger_motion')
						shift(
							group,
							number(i.offsetFrames) * (i.direction === 'reverse' ? ids.length - 1 - index : index)
						);
					else if (op.name === 'distribute_timing') {
						const start = number(i.startFrame, 0),
							end = number(i.endFrame, start);
						shift(
							group,
							Math.round(
								start + (end - start) * (ids.length === 1 ? 0 : index / (ids.length - 1))
							) - gs.start
						);
					} else {
						const mode = i.mode ?? 'start';
						check(['start', 'end', 'center'].includes(String(mode)), 'Invalid align mode');
						const anchor = number(i.frame, 0);
						shift(
							group,
							Math.round(
								anchor -
									(mode === 'end' ? gs.end : mode === 'center' ? (gs.start + gs.end) / 2 : gs.start)
							)
						);
					}
				}
				return;
			}
			if (op.name === 'retime_motion') {
				const scale = number(i.scale, 0.001, 100);
				check(
					['start', 'end', 'center', 'playhead'].includes(String(i.anchor)),
					'Invalid retime anchor'
				);
				const anchor =
					i.anchor === 'end'
						? s.end
						: i.anchor === 'center'
							? (s.start + s.end) / 2
							: i.anchor === 'playhead'
								? number(i.playhead, 0)
								: s.start;
				for (const r of rs)
					for (const k of r.keys) k.frame = Math.round(anchor + (k.frame - anchor) * scale);
				return;
			}
			if (op.name === 'reverse_motion') {
				for (const r of rs) {
					const old = structuredClone(r.keys);
					check(
						!old.slice(0, -1).some((k) => k.easing.type === 'hold'),
						'Reverse of hold segments requires step-boundary editing; use explicit keys'
					);
					for (const [index, k] of r.keys.entries()) {
						k.frame = s.start + s.end - k.frame;
						const e = old[index - 1]?.easing ?? presets.linear;
						k.easing =
							e.type === 'bezier'
								? { type: 'bezier', x1: 1 - e.x2, y1: 1 - e.y2, x2: 1 - e.x1, y2: 1 - e.y1 }
								: structuredClone(e);
					}
				}
				return;
			}
			if (op.name === 'normalize_motion') {
				const source = layerById(p, i.sourceLayerId);
				for (const r of rs) {
					const st = source.tracks[r.property];
					check(st?.keys.length >= 2, 'Reference needs matching motion');
					check(r.keys.length >= 2, 'Target needs at least two keys');
					const a = { ...r.keys[0] },
						b = { ...r.keys.at(-1)! };
					check(b.frame > a.frame, 'Empty span');
					const sa = { ...st.keys[0] },
						sb = { ...st.keys.at(-1)! };
					for (const k of r.keys) {
						k.frame = Math.round(
							sa.frame + ((k.frame - a.frame) / (b.frame - a.frame)) * (sb.frame - sa.frame)
						);
						k.easing = structuredClone(sa.easing);
					}
				}
				return;
			}
			const amount = number(i.amount ?? 0.08, 0, 1),
				settle = number(i.settleFrames ?? 5, 1, 120);
			check(Number.isInteger(settle), 'Settle frames must be an integer');
			for (const r of rs) {
				check(r.keys.length >= 2, 'Need two keys for overshoot/anticipation');
				check(
					!['opacity', 'paintOpacity', 'strokeWidth', 'cornerRadius'].includes(r.property) &&
						!r.property.startsWith('gradient.'),
					'Overshoot/anticipation supports position, scale, rotation, width, and height'
				);
				const a = r.keys[0],
					b = r.keys.at(-1)!;
				check(
					typeof a.value === 'number' && typeof b.value === 'number',
					'Numeric properties only'
				);
				check(b.frame - a.frame > settle, 'Not enough room for settle frames');
				const frame = op.name === 'add_overshoot' ? b.frame - settle : a.frame + settle;
				check(
					!r.track.keys.some((k) => k.frame === frame),
					'New key collides with existing motion'
				);
				const v =
					op.name === 'add_overshoot'
						? b.value + (b.value - a.value) * amount
						: a.value - (b.value - a.value) * amount;
				put(r.track, frame, v, presets.smooth);
				a.easing = structuredClone(presets.smooth);
			}
			return;
		}
		default:
			throw new Error(`Unknown motion command: ${op.name}`);
	}
}
export function transact(
	project: Project,
	operations: Operation[]
): { project: Project; data: unknown[] } {
	check(operations.length > 0 && operations.length <= 100, 'A batch needs 1–100 operations');
	let next = structuredClone(project);
	const data: unknown[] = [];
	for (const op of operations) {
		const before = structuredClone(next);
		data.push(apply(next, op));
		for (const l of next.layers)
			for (const t of Object.values(l.tracks)) t.keys.sort((a, b) => a.frame - b.frame);
		locked(before, next, op.input.preserve as Input | undefined);
		next = validateProject(next);
	}
	next.revision = project.revision + 1;
	next.updatedAt = new Date().toISOString();
	return { project: next, data };
}
export function findElements(p: Project, input: Input) {
	const normalize = (s: string) => {
		const v = s.normalize('NFC').trim();
		return input.caseSensitive === false ? v.toLocaleLowerCase('en-US') : v;
	};
	const query = normalize(string(input.text, 10000));
	check(query.length, 'Enter text to find');
	check(
		input.match === undefined || ['exact', 'contains'].includes(String(input.match)),
		'Invalid match mode'
	);
	return p.layers
		.filter(
			(l) =>
				l.type === 'text' &&
				(input.visibleOnly !== true || l.visible) &&
				(input.layerIds === undefined || strings(input.layerIds).includes(l.id)) &&
				(input.match === 'contains'
					? normalize(l.text).includes(query)
					: normalize(l.text) === query)
		)
		.map((l) => ({
			id: l.id,
			name: l.name,
			text: l.text,
			visible: l.visible,
			locked: l.locked,
			spans: Object.entries(l.tracks)
				.filter(([, t]) => t.keys.length)
				.map(([property, t]) => ({
					property,
					startFrame: t.keys[0].frame,
					endFrame: t.keys.at(-1)!.frame,
					keyCount: t.keys.length
				}))
		}));
}
