import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { createProject, createLayer, uid } from '../src/lib/features/motion/model';
import { saveMotion, loadMotion, listMotion } from '../src/lib/features/motion/storage';
it('round-trips embedded artwork and independent tracks in a separate v2 database', async () => {
	const p = createProject();
	const l = createLayer('png');
	l.assetId = uid();
	p.assets.push({
		id: l.assetId,
		name: 'pixel',
		mime: 'image/png',
		width: 1,
		height: 1,
		data: 'data:image/png;base64,iVBORw0KGgo='
	});
	p.layers.push(l);
	await saveMotion(p);
	expect(await loadMotion(p.id)).toEqual(p);
	expect((await listMotion()).find((s) => s.id === p.id)?.layerCount).toBe(1);
});
