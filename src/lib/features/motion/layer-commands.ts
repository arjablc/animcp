import {
	addStop,
	check,
	copyPaths,
	createLayer,
	evaluate,
	number,
	setGradient,
	string,
	type Layer,
	type Project,
	type Track,
	type Value,
	uid
} from './model';
import {
	editable,
	easing,
	editWholeTrack,
	layerById,
	put,
	strings,
	type Input,
	type Operation,
	unhandled
} from './command-core';

export function applyLayerCommand(p: Project, op: Operation): unknown | typeof unhandled {
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
			if (l.type === 'path') {
				l.paths = copyPaths(i.paths);
				const bounds = i.bounds as Record<string, unknown> | undefined;
				check(bounds && typeof bounds === 'object', 'A path needs bounds');
				for (const property of ['positionX', 'positionY', 'width', 'height'] as const)
					l.tracks[property].defaultValue = number(
						bounds[property],
						property.startsWith('position') ? -1e6 : 0.001
					);
			}
			p.layers.push(l);
			return { layerId: l.id };
		}
		case 'set_path': {
			const l = editable(p, i.layerId);
			check(l.type === 'path', 'Only path layers have editable path points');
			l.paths = copyPaths(i.paths);
			return;
		}
		case 'group_layers': {
			const childIds = strings(i.layerIds);
			check(childIds.length >= 2, 'Select at least two layers to group');
			check(new Set(childIds).size === childIds.length, 'Duplicate group child');
			const children = childIds.map((id) => editable(p, id));
			check(
				children.every((child) => child.type !== 'group'),
				'Group nested groups separately'
			);
			const parentId = children[0].parentId;
			check(
				children.every((child) => child.parentId === parentId),
				'Group only layers at the same hierarchy level'
			);
			const group = createLayer('group', string(i.name ?? 'Group', 200));
			group.parentId = parentId;
			const left = Math.min(
				...children.map((child) => Number(evaluate(child.tracks.positionX, 0)))
			);
			const top = Math.min(...children.map((child) => Number(evaluate(child.tracks.positionY, 0))));
			const right = Math.max(
				...children.map(
					(child) =>
						Number(evaluate(child.tracks.positionX, 0)) +
						Number(evaluate(child.tracks.width, 0)) * Number(evaluate(child.tracks.scaleX, 0))
				)
			);
			const bottom = Math.max(
				...children.map(
					(child) =>
						Number(evaluate(child.tracks.positionY, 0)) +
						Number(evaluate(child.tracks.height, 0)) * Number(evaluate(child.tracks.scaleY, 0))
				)
			);
			group.tracks.positionX.defaultValue = left;
			group.tracks.positionY.defaultValue = top;
			group.tracks.width.defaultValue = Math.max(1, right - left);
			group.tracks.height.defaultValue = Math.max(1, bottom - top);
			const index = Math.min(...children.map((child) => p.layers.indexOf(child)));
			p.layers.splice(index, 0, group);
			for (const child of children) {
				for (const [property, offset] of [
					['positionX', left],
					['positionY', top]
				] as const) {
					const motion = child.tracks[property];
					motion.defaultValue = Number(motion.defaultValue) - offset;
					for (const key of motion.keys) key.value = Number(key.value) - offset;
				}
				child.parentId = group.id;
			}
			return { layerId: group.id };
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
			const toDelete = new Set<string>([String(i.layerId)]);
			for (let changed = true; changed;) {
				changed = false;
				for (const layer of p.layers)
					if (layer.parentId && toDelete.has(layer.parentId) && !toDelete.has(layer.id)) {
						toDelete.add(layer.id);
						changed = true;
					}
			}
			for (const id of toDelete) editable(p, id);
			p.layers = p.layers.filter((l) => !toDelete.has(l.id));
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
						'letterSpacing',
						'textAlign'
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
			if (op.name === 'set_property' && i.trackEdit === true) {
				editWholeTrack(t, property, number(i.referenceFrame, 0), v);
			} else if (op.name === 'add_keyframe' || i.frame !== undefined)
				put(t, number(i.frame, 0), v, i.easing ? easing(i) : undefined);
			else t.defaultValue = v;
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
		default:
			return unhandled;
	}
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
