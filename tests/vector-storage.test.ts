import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	IDBDatabase,
	IDBFactory,
	IDBObjectStore,
	IDBOpenDBRequest,
	IDBVersionChangeEvent
} from 'fake-indexeddb';
import {
	createAnimationProject,
	defaultStyle,
	identityTransform,
	type AnimationProject
} from '../src/lib/features/animation/model';
import {
	createAutosaver,
	deleteAsset,
	deleteProject,
	getAsset,
	listProjects,
	loadProject,
	putAsset,
	saveProject,
	type AutosaveStatus
} from '../src/lib/features/persistence/vector-storage';

function project(revision = 0, id = 'project_a'): AnimationProject {
	return {
		...createAnimationProject({ id, name: 'Vector fixture' }),
		revision,
		createdAt: '2026-08-30T12:00:00.000Z',
		updatedAt: '2026-08-31T12:00:00.000Z',
		layers: [
			{
				id: 'layer_a',
				name: 'Line',
				visible: true,
				locked: false,
				zIndex: 0,
				style: defaultStyle(),
				keyframes: {
					0: {
						paths: [
							[
								{ type: 'M', x: 10, y: 20 },
								{ type: 'L', x: 30, y: 40 }
							]
						],
						transform: identityTransform(),
						easing: { type: 'linear' }
					}
				}
			}
		]
	};
}

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function rawDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('animcp-vector-v1', 1);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function corruptRecord(store: string, value: unknown) {
	const database = await rawDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = database.transaction(store, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error);
			tx.objectStore(store).put(value);
		});
	} finally {
		database.close();
	}
}

beforeEach(() => {
	vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('vector IndexedDB persistence', () => {
	it('round-trips canonical geometry, timing and style through detached snapshots', async () => {
		const original = project();
		const saving = saveProject(original);
		original.name = 'Changed while opening IndexedDB';
		await saving;
		const loaded = await loadProject(original.id);
		expect(loaded).toEqual(project());
		loaded!.layers[0].style.stroke = '#ffffff';
		expect((await loadProject(original.id))!.layers[0].style.stroke).toBe('#00c3ff');
	});

	it('lists metadata without reading the document or asset stores', async () => {
		await saveProject(project());
		const newer = project(1, 'newer');
		newer.updatedAt = '2026-08-31T13:00:00.000Z';
		await saveProject(newer);
		const reads = vi.spyOn(IDBObjectStore.prototype, 'get');
		const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
		const summaries = await listProjects();
		expect(summaries.map((summary) => summary.id)).toEqual(['newer', 'project_a']);
		expect(summaries[0]).toMatchObject({ layerCount: 1, assetCount: 0, revision: 1 });
		expect(summaries[0]).not.toHaveProperty('layers');
		expect(summaries[0]).not.toHaveProperty('assets');
		expect(summaries[0]).not.toHaveProperty('document');
		expect(reads).not.toHaveBeenCalled();
		expect(getAll.mock.contexts.map((store) => (store as IDBObjectStore).name)).toEqual([
			'projects'
		]);
	});

	it('returns undefined for missing records and makes scoped deletion idempotent', async () => {
		expect(await listProjects()).toEqual([]);
		expect(await loadProject('missing')).toBeUndefined();
		expect(await getAsset('missing', 'asset')).toBeUndefined();
		await deleteAsset('missing', 'asset');
		await deleteProject('missing');
	});

	it('never reads, migrates, clears or overwrites legacy p5 localStorage', async () => {
		const legacy = {
			getItem: vi.fn(() => '[{"id":"legacy"}]'),
			setItem: vi.fn(),
			removeItem: vi.fn(),
			clear: vi.fn()
		};
		vi.stubGlobal('localStorage', legacy);
		await saveProject(project());
		await loadProject('project_a');
		await listProjects();
		await deleteProject('project_a');
		for (const method of Object.values(legacy)) expect(method).not.toHaveBeenCalled();
		expect((await indexedDB.databases()).map((database) => database.name)).toEqual([
			'animcp-vector-v1'
		]);
	});

	it('rejects malformed projects before opening the database', async () => {
		const open = vi.spyOn(indexedDB, 'open');
		const invalid = project();
		invalid.canvas.width = -1;
		await expect(saveProject(invalid)).rejects.toThrow();
		expect(open).not.toHaveBeenCalled();
	});

	it('rejects corrupted documents and metadata instead of returning missing/empty data', async () => {
		await saveProject(project());
		await corruptRecord('documents', { id: 'project_a', document: { version: 1 } });
		await expect(loadProject('project_a')).rejects.toThrow();
		expect(await listProjects()).toHaveLength(1);
		await corruptRecord('projects', { id: 'project_a', layerCount: -1 });
		await expect(listProjects()).rejects.toThrow(/corrupt/);
	});

	it('detects a document whose metadata no longer matches', async () => {
		await saveProject(project());
		const changed = project();
		changed.name = 'Corrupt mismatch';
		await corruptRecord('documents', { id: changed.id, document: changed });
		await expect(loadProject(changed.id)).rejects.toThrow(/does not match/);
	});

	it('prevents stale or conflicting revision writes but allows identical retries', async () => {
		await saveProject(project(2));
		await expect(saveProject(project(1))).rejects.toThrow(/Revision conflict/);
		await expect(saveProject({ ...project(2), name: 'Conflict' })).rejects.toThrow(
			/Revision conflict/
		);
		await saveProject(project(2));
		expect((await loadProject('project_a'))!.revision).toBe(2);
	});

	it('serializes competing transactions without allowing the stored revision to decrease', async () => {
		await saveProject(project(1));
		const outcomes = await Promise.allSettled([saveProject(project(3)), saveProject(project(2))]);
		expect(outcomes[0].status).toBe('fulfilled');
		expect((await loadProject('project_a'))!.revision).toBe(3);
		expect((await listProjects())[0].revision).toBe(3);
	});

	it('rolls back document and summary together when a quota error occurs', async () => {
		await saveProject(project(1));
		const quota = new DOMException('Storage full', 'QuotaExceededError');
		const original = IDBObjectStore.prototype.put;
		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			value,
			key
		) {
			if (this.name === 'projects') throw quota;
			return original.call(this, value, key);
		});
		await expect(saveProject(project(2))).rejects.toBe(quota);
		put.mockRestore();
		expect((await loadProject('project_a'))!.revision).toBe(1);
		expect((await listProjects())[0].revision).toBe(1);
		await saveProject(project(2));
	});

	it('waits for transaction completion even after a successful asset request', async () => {
		await listProjects();
		const original = IDBObjectStore.prototype.put;
		const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
			this: IDBObjectStore,
			value,
			key
		) {
			const request = original.call(this, value, key);
			request.addEventListener('success', () => this.transaction.abort(), { once: true });
			return request;
		});
		await expect(putAsset('project_a', 'image', new Blob(['image']))).rejects.toMatchObject({
			name: 'AbortError'
		});
		put.mockRestore();
		expect(await getAsset('project_a', 'image')).toBeUndefined();
	});

	it('stores colliding asset IDs under separate owners and deletes only the requested asset', async () => {
		await putAsset('project_a', 'same', new Blob(['A'], { type: 'image/png' }));
		await putAsset('project_b', 'same', new Blob(['B'], { type: 'image/webp' }));
		expect(await (await getAsset('project_a', 'same'))!.text()).toBe('A');
		expect((await getAsset('project_b', 'same'))!.type).toBe('image/webp');
		await deleteAsset('project_a', 'same');
		expect(await getAsset('project_a', 'same')).toBeUndefined();
		expect(await (await getAsset('project_b', 'same'))!.text()).toBe('B');
	});

	it('uses compound keys even when identifiers contain delimiters', async () => {
		await putAsset('a:b', 'c', new Blob(['first']));
		await putAsset('a', 'b:c', new Blob(['second']));
		await deleteProject('a:b');
		expect(await (await getAsset('a', 'b:c'))!.text()).toBe('second');
	});

	it('deletes only assets indexed to the project, including unreferenced owned assets', async () => {
		await saveProject(project());
		await saveProject(project(0, 'project_b'));
		await putAsset('project_a', 'shared', new Blob(['A']));
		await putAsset('project_a', 'orphan', new Blob(['orphan']));
		await putAsset('project_b', 'shared', new Blob(['B']));
		await deleteProject('project_a');
		expect(await loadProject('project_a')).toBeUndefined();
		expect(await getAsset('project_a', 'shared')).toBeUndefined();
		expect(await getAsset('project_a', 'orphan')).toBeUndefined();
		expect(await (await getAsset('project_b', 'shared'))!.text()).toBe('B');
		expect((await listProjects()).map((summary) => summary.id)).toEqual(['project_b']);
	});

	it('rolls back project deletion and owned asset cleanup if any deletion fails', async () => {
		await saveProject(project());
		await putAsset('project_a', 'image', new Blob(['A']));
		const original = IDBObjectStore.prototype.delete;
		const remove = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
			this: IDBObjectStore,
			key
		) {
			if (this.name === 'assets') throw new Error('Deletion failed');
			return original.call(this, key);
		});
		await expect(deleteProject('project_a')).rejects.toThrow('Deletion failed');
		remove.mockRestore();
		expect(await loadProject('project_a')).toEqual(project());
		expect(await (await getAsset('project_a', 'image'))!.text()).toBe('A');
	});

	it('rejects corrupted asset records and non-Blob writes', async () => {
		await listProjects();
		await corruptRecord('assets', {
			projectId: 'project_a',
			assetId: 'broken',
			blob: 'not a blob',
			byteLength: 10
		});
		await expect(getAsset('project_a', 'broken')).rejects.toThrow(/corrupt/);
		await expect(putAsset('project_a', 'broken', 'data' as unknown as Blob)).rejects.toThrow(
			/Blob/
		);
	});

	it('surfaces unavailable and denied storage, and permits a later retry', async () => {
		vi.stubGlobal('indexedDB', undefined);
		await expect(listProjects()).rejects.toThrow(/unavailable/);
		await expect(saveProject(project())).rejects.toThrow(/not been saved/);
		vi.stubGlobal('indexedDB', new IDBFactory());
		const denied = new DOMException('Access denied', 'SecurityError');
		vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
			throw denied;
		});
		await expect(saveProject(project())).rejects.toBe(denied);
		await saveProject(project());
		expect(await loadProject('project_a')).toEqual(project());
	});

	it('rejects a blocked database open instead of leaving a save hanging', async () => {
		const request = new IDBOpenDBRequest();
		vi.spyOn(indexedDB, 'open').mockReturnValueOnce(request);
		const saving = saveProject(project());
		const rejection = expect(saving).rejects.toThrow(/blocked/);
		request.onblocked?.(new IDBVersionChangeEvent('blocked'));
		await rejection;
		await saveProject(project());
	});

	it('surfaces schema creation errors and retries without a partially created database', async () => {
		const error = new DOMException('Storage full', 'QuotaExceededError');
		const create = vi.spyOn(IDBDatabase.prototype, 'createObjectStore');
		create.mockImplementationOnce(() => {
			throw error;
		});
		await expect(saveProject(project())).rejects.toBe(error);
		create.mockRestore();
		await saveProject(project());
		expect(await loadProject('project_a')).toEqual(project());
	});
});

describe('vector autosaver', () => {
	const savers: ReturnType<typeof createAutosaver>[] = [];
	function autosaver(options: Parameters<typeof createAutosaver>[0]) {
		const saver = createAutosaver(options);
		savers.push(saver);
		return saver;
	}
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(async () => {
		await Promise.all(savers.splice(0).map((saver) => saver.dispose().catch(() => undefined)));
	});

	it('debounces edits, snapshots values, and reports saved only after persistence resolves', async () => {
		const committed = deferred();
		const save = vi.fn(() => committed.promise);
		const status = vi.fn<(status: AutosaveStatus) => void>();
		const saver = autosaver({ save, onStatus: status, debounceMs: 100 });
		const latest = project(2);
		saver.schedule(project(1));
		saver.schedule(latest);
		latest.name = 'Changed after scheduling';
		await vi.advanceTimersByTimeAsync(99);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledExactlyOnceWith(project(2));
		expect(status.mock.calls.at(-1)![0]).toMatchObject({ state: 'saving', savedRevision: null });
		committed.resolve();
		await saver.flush();
		expect(status.mock.calls.at(-1)![0]).toMatchObject({
			state: 'saved',
			revision: 2,
			savedRevision: 2
		});
	});

	it('serializes writes and drains the newest pending revision when flush is already running', async () => {
		const first = deferred();
		const second = deferred();
		const save = vi
			.fn()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);
		const status = vi.fn<(status: AutosaveStatus) => void>();
		const saver = autosaver({ save, onStatus: status });
		saver.schedule(project(1));
		const flushed = saver.flush();
		await Promise.resolve();
		saver.schedule(project(3));
		saver.schedule(project(2));
		expect(saver.flush()).toBe(flushed);
		expect(save).toHaveBeenCalledTimes(1);
		first.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(save.mock.calls.map(([value]) => value.revision)).toEqual([1, 3]);
		expect(status.mock.calls.map(([value]) => value.state)).not.toContain('saved');
		second.resolve();
		await flushed;
		expect(status.mock.calls.at(-1)![0]).toMatchObject({ state: 'saved', savedRevision: 3 });
	});

	it('retains a failed snapshot for explicit retry without advancing the saved revision', async () => {
		const error = new DOMException('Full', 'QuotaExceededError');
		const save = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(error)
			.mockResolvedValue(undefined);
		const status = vi.fn<(status: AutosaveStatus) => void>();
		const saver = autosaver({ save, onStatus: status });
		saver.schedule(project(1));
		await saver.flush();
		saver.schedule(project(2));
		await expect(saver.flush()).rejects.toBe(error);
		expect(status.mock.calls.at(-1)![0]).toMatchObject({
			state: 'error',
			revision: 2,
			savedRevision: 1,
			error
		});
		await saver.flush();
		expect(save.mock.calls.map(([value]) => value.revision)).toEqual([1, 2, 2]);
		expect(status.mock.calls.at(-1)![0]).toMatchObject({ state: 'saved', savedRevision: 2 });
	});

	it('keeps a newer pending revision when an older in-flight save fails', async () => {
		const first = deferred();
		const save = vi
			.fn()
			.mockImplementationOnce(() => first.promise)
			.mockResolvedValue(undefined);
		const saver = autosaver({ save });
		saver.schedule(project(1));
		const flushed = saver.flush();
		const rejection = expect(flushed).rejects.toThrow('Full');
		await Promise.resolve();
		saver.schedule(project(3));
		first.reject(new Error('Full'));
		await rejection;
		await saver.flush();
		expect(save.mock.calls.map(([value]) => value.revision)).toEqual([1, 3]);
	});

	it('does not confuse revisions or lose pending saves when project IDs change', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const saver = autosaver({ save });
		saver.schedule(project(8, 'first'));
		saver.schedule(project(1, 'second'));
		saver.schedule(project(9, 'first'));
		await saver.flush();
		expect(save.mock.calls.map(([value]) => [value.id, value.revision])).toEqual([
			['first', 9],
			['second', 1]
		]);
	});

	it('ignores stale/duplicate scheduled revisions after a successful save', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const saver = autosaver({ save });
		saver.schedule(project(4));
		await saver.flush();
		saver.schedule(project(3));
		saver.schedule(project(4));
		await saver.flush();
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('reports background failures and allows rescheduling the same pending revision to retry', async () => {
		const error = new Error('Full');
		const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
		const status = vi.fn<(status: AutosaveStatus) => void>();
		const saver = autosaver({ save, onStatus: status, debounceMs: 10 });
		saver.schedule(project(1));
		await vi.advanceTimersByTimeAsync(10);
		expect(status.mock.calls.at(-1)![0]).toMatchObject({
			state: 'error',
			error,
			savedRevision: null
		});
		saver.schedule(project(1));
		await vi.advanceTimersByTimeAsync(10);
		expect(save).toHaveBeenCalledTimes(2);
		expect(status.mock.calls.at(-1)![0]).toMatchObject({ state: 'saved', savedRevision: 1 });
	});

	it('flushes and detaches on disposal, and leaves failed disposal retryable', async () => {
		const save = vi.fn().mockRejectedValueOnce(new Error('Full')).mockResolvedValue(undefined);
		const saver = autosaver({ save });
		saver.schedule(project(1));
		await expect(saver.dispose()).rejects.toThrow('Full');
		expect(() => saver.schedule(project(2))).toThrow(/disposed/);
		await saver.flush();
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(2);
	});

	it('flushes on hidden visibility/page exit and removes all listeners on disposal', async () => {
		const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
		const browser = new EventTarget();
		vi.stubGlobal('document', page);
		vi.stubGlobal('window', browser);
		const removePage = vi.spyOn(page, 'removeEventListener');
		const removeBrowser = vi.spyOn(browser, 'removeEventListener');
		const save = vi.fn().mockResolvedValue(undefined);
		const saver = autosaver({ save });
		saver.schedule(project(1));
		page.dispatchEvent(new Event('visibilitychange'));
		await Promise.resolve();
		expect(save).not.toHaveBeenCalled();
		page.visibilityState = 'hidden';
		page.dispatchEvent(new Event('visibilitychange'));
		await saver.flush();
		for (const [index, event] of ['pagehide', 'beforeunload'].entries()) {
			saver.schedule(project(index + 2));
			browser.dispatchEvent(new Event(event));
			await saver.flush();
		}
		expect(save).toHaveBeenCalledTimes(3);
		await saver.dispose();
		expect(removePage.mock.calls.map(([event]) => event)).toEqual(['visibilitychange']);
		expect(removeBrowser.mock.calls.map(([event]) => event)).toEqual(['pagehide', 'beforeunload']);
	});

	it('preserves valid pending work when later validation or a UI observer fails', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const saver = autosaver({
			save,
			onStatus: () => {
				throw new Error('UI failure');
			}
		});
		saver.schedule(project(1));
		expect(() => saver.schedule({ ...project(2), revision: -1 })).toThrow();
		await saver.flush();
		expect(save).toHaveBeenCalledExactlyOnceWith(project(1));
	});
});
