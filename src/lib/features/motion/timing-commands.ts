import { check, evaluate, number, presets, type Easing, type Project, uid } from './model';
import {
	editable,
	easing,
	layerById,
	put,
	refs,
	shift,
	span,
	strings,
	type Operation,
	unhandled
} from './command-core';

export function applyTimingCommand(p: Project, op: Operation): unknown | typeof unhandled {
	const i = op.input;
	switch (op.name) {
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
			return unhandled;
	}
}
