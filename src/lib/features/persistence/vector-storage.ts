import type { AnimationProject } from '../animation/model';
import { parseProject } from '../animation/validation';

const databaseName = 'animcp-vector-v1';
const databaseVersion = 1;
const projectStores = ['projects', 'documents'];

export type ProjectSummary = Pick<
	AnimationProject,
	| 'id'
	| 'name'
	| 'version'
	| 'kind'
	| 'revision'
	| 'createdAt'
	| 'updatedAt'
	| 'canvas'
	| 'timeline'
> & { layerCount: number; assetCount: number };

function summaryOf(project: AnimationProject): ProjectSummary {
	const { id, name, version, kind, revision, createdAt, updatedAt, canvas, timeline } = project;
	return {
		id,
		name,
		version,
		kind,
		revision,
		createdAt,
		updatedAt,
		canvas,
		timeline,
		layerCount: project.layers.length,
		assetCount: project.assets.length
	};
}

function assertId(id: string): void {
	if (typeof id !== 'string' || id.trim().length === 0) {
		throw new Error('A non-empty project or asset ID is required.');
	}
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is unavailable. Your changes have not been saved.'));
			return;
		}
		const request = indexedDB.open(databaseName, databaseVersion);
		let abandoned = false;
		request.onblocked = () => {
			abandoned = true;
			reject(new Error('Vector storage is blocked by another tab. Close it and retry saving.'));
		};
		request.onerror = () => reject(request.error ?? new Error('Unable to open vector storage.'));
		request.onupgradeneeded = () => {
			if (abandoned) {
				request.transaction?.abort();
				return;
			}
			try {
				const database = request.result;
				// Listing never reads or clones project geometry: summaries and documents commit together.
				const projects = database.createObjectStore('projects', { keyPath: 'id' });
				projects.createIndex('updatedAt', 'updatedAt');
				database.createObjectStore('documents', { keyPath: 'id' });
				const assets = database.createObjectStore('assets', { keyPath: ['projectId', 'assetId'] });
				assets.createIndex('projectId', 'projectId');
			} catch (error) {
				abandoned = true;
				request.transaction?.abort();
				reject(error);
			}
		};
		request.onsuccess = () => {
			const database = request.result;
			if (abandoned) {
				database.close();
				return;
			}
			database.onversionchange = () => database.close();
			resolve(database);
		};
	});
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	const value = new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Vector storage request failed.'));
	});
	// A later request can throw synchronously before Promise.all attaches to earlier requests.
	// Observe their eventual abort without changing the rejected promise returned to the caller.
	void value.catch(() => undefined);
	return value;
}

async function transaction<T>(
	stores: string[],
	mode: IDBTransactionMode,
	operation: (transaction: IDBTransaction) => Promise<T>
): Promise<T> {
	const database = await openDatabase();
	try {
		const tx = database.transaction(stores, mode);
		const committed = new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onabort = () =>
				reject(tx.error ?? new DOMException('Vector storage transaction aborted.', 'AbortError'));
			tx.onerror = () => {
				// Requests reject with their original error; abort is the final transaction outcome.
			};
		});
		try {
			const [value] = await Promise.all([operation(tx), committed]);
			return value;
		} catch (error) {
			try {
				tx.abort();
			} catch {
				// A failed transaction may already be finished.
			}
			await committed.catch(() => undefined);
			throw error;
		}
	} finally {
		// No cached failed/open connection can poison retries or block a later upgrade.
		database.close();
	}
}

function parseSummary(value: ProjectSummary): ProjectSummary {
	if (
		!value ||
		!Number.isSafeInteger(value.layerCount) ||
		value.layerCount < 0 ||
		!Number.isSafeInteger(value.assetCount) ||
		value.assetCount < 0
	) {
		throw new Error('Stored vector project metadata is corrupt.');
	}
	const { id, name, version, kind, revision, createdAt, updatedAt, canvas, timeline } = value;
	const project = parseProject({
		id,
		name,
		version,
		kind,
		revision,
		createdAt,
		updatedAt,
		canvas,
		timeline,
		layers: [],
		assets: []
	});
	return { ...summaryOf(project), layerCount: value.layerCount, assetCount: value.assetCount };
}

export async function listProjects(): Promise<ProjectSummary[]> {
	return transaction(['projects'], 'readonly', async (tx) => {
		const values: ProjectSummary[] = await requestValue(tx.objectStore('projects').getAll());
		return values
			.map(parseSummary)
			.sort(
				(a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
			);
	});
}

export async function loadProject(id: string): Promise<AnimationProject | undefined> {
	assertId(id);
	return transaction(projectStores, 'readonly', async (tx) => {
		const [record, summary] = await Promise.all([
			requestValue(tx.objectStore('documents').get(id)),
			requestValue(tx.objectStore('projects').get(id))
		]);
		if (record === undefined && summary === undefined) return undefined;
		if (!record || !summary) throw new Error('Stored vector project is incomplete.');
		const project = parseProject(record.document);
		const metadata = parseSummary(summary);
		if (project.id !== id || JSON.stringify(summaryOf(project)) !== JSON.stringify(metadata)) {
			throw new Error('Stored vector project metadata does not match its document.');
		}
		return project;
	});
}

export async function saveProject(project: AnimationProject): Promise<void> {
	// Snapshot before opening the database so caller mutations cannot change an in-flight save.
	const snapshot = structuredClone(parseProject(project));
	await transaction(projectStores, 'readwrite', async (tx) => {
		const documents = tx.objectStore('documents');
		const existing = await requestValue(documents.get(snapshot.id));
		if (existing !== undefined) {
			const current = parseProject(existing.document);
			if (
				current.revision > snapshot.revision ||
				(current.revision === snapshot.revision &&
					JSON.stringify(current) !== JSON.stringify(snapshot))
			) {
				throw new Error(
					'Revision conflict: the stored project already contains this revision or a newer one.'
				);
			}
		}
		await Promise.all([
			requestValue(documents.put({ id: snapshot.id, document: snapshot })),
			requestValue(tx.objectStore('projects').put(summaryOf(snapshot)))
		]);
	});
}

export async function deleteProject(id: string): Promise<void> {
	assertId(id);
	await transaction([...projectStores, 'assets'], 'readwrite', async (tx) => {
		const assets = tx.objectStore('assets');
		// Resolve only keys owned by this project; blobKey strings never authorize deletion.
		const keys = await requestValue(assets.index('projectId').getAllKeys(id));
		await Promise.all([
			requestValue(tx.objectStore('projects').delete(id)),
			requestValue(tx.objectStore('documents').delete(id)),
			...keys.map((key) => requestValue(assets.delete(key)))
		]);
	});
}

export async function putAsset(projectId: string, assetId: string, blob: Blob): Promise<void> {
	assertId(projectId);
	assertId(assetId);
	if (!(blob instanceof Blob)) throw new Error('Asset data must be a Blob.');
	await transaction(['assets'], 'readwrite', async (tx) => {
		await requestValue(
			tx.objectStore('assets').put({
				projectId,
				assetId,
				blob,
				mimeType: blob.type,
				byteLength: blob.size
			})
		);
	});
}

export async function getAsset(projectId: string, assetId: string): Promise<Blob | undefined> {
	assertId(projectId);
	assertId(assetId);
	return transaction(['assets'], 'readonly', async (tx) => {
		const record = await requestValue(tx.objectStore('assets').get([projectId, assetId]));
		if (record === undefined) return undefined;
		if (
			record.projectId !== projectId ||
			record.assetId !== assetId ||
			!(record.blob instanceof Blob) ||
			record.byteLength !== record.blob.size ||
			record.mimeType !== record.blob.type
		) {
			throw new Error('Stored vector asset is corrupt.');
		}
		return record.blob;
	});
}

export async function deleteAsset(projectId: string, assetId: string): Promise<void> {
	assertId(projectId);
	assertId(assetId);
	await transaction(['assets'], 'readwrite', async (tx) => {
		await requestValue(tx.objectStore('assets').delete([projectId, assetId]));
	});
}

export type AutosaveStatus = {
	state: 'pending' | 'saving' | 'saved' | 'error';
	projectId: string;
	revision: number;
	savedRevision: number | null;
	error?: Error;
};

export type SaveStatus = AutosaveStatus;

export type AutosaverOptions = {
	save?: (project: AnimationProject) => Promise<void>;
	onStatus?: (status: AutosaveStatus) => void;
	debounceMs?: number;
};

/** Serial, debounced saves. Failed snapshots stay queued; flush() explicitly retries them.
 * dispose() detaches lifecycle listeners and flushes, and rejects if that save fails.
 * A disposed saver rejects schedule(), but flush()/dispose() can still retry pending data.
 */
export function createAutosaver({
	save = saveProject,
	onStatus,
	debounceMs = 400
}: AutosaverOptions = {}) {
	if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new Error('Invalid autosave delay.');
	const pending = new Map<string, AnimationProject>();
	const highestRevision = new Map<string, number>();
	const savedRevision = new Map<string, number>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running: Promise<void> | undefined;
	let disposed = false;

	function notify(project: AnimationProject, state: AutosaveStatus['state'], error?: unknown) {
		const status: AutosaveStatus = {
			state,
			projectId: project.id,
			revision: project.revision,
			savedRevision: savedRevision.get(project.id) ?? null,
			...(state === 'error'
				? { error: error instanceof Error ? error : new Error(String(error)) }
				: {})
		};
		try {
			onStatus?.(status);
		} catch {
			// UI observers must not change transaction outcomes or discard pending snapshots.
		}
	}

	function clearTimer() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	}

	async function drain() {
		while (pending.size > 0) {
			const project = pending.values().next().value!;
			notify(project, 'saving');
			try {
				await save(structuredClone(project));
			} catch (error) {
				notify(pending.get(project.id) ?? project, 'error', error);
				throw error;
			}
			savedRevision.set(project.id, project.revision);
			if (pending.get(project.id) === project) pending.delete(project.id);
			const next = pending.get(project.id);
			notify(next ?? project, next ? 'pending' : 'saved');
		}
	}

	function flush(): Promise<void> {
		clearTimer();
		if (running) return running;
		if (pending.size === 0) return Promise.resolve();
		// Defer drain until running is assigned, including when a status callback reenters flush.
		running = Promise.resolve()
			.then(drain)
			.finally(() => {
				running = undefined;
			});
		return running;
	}

	function flushInBackground() {
		void flush().catch(() => {
			// The error was reported through onStatus; the snapshot remains available for retry.
		});
	}

	function schedule(project: AnimationProject): void {
		if (disposed) throw new Error('This autosaver has been disposed.');
		const snapshot = structuredClone(parseProject(project));
		const highest = highestRevision.get(snapshot.id) ?? -1;
		if (snapshot.revision < highest) return;
		if (snapshot.revision > highest) {
			highestRevision.set(snapshot.id, snapshot.revision);
			pending.set(snapshot.id, snapshot);
			notify(snapshot, 'pending');
		}
		if (pending.size > 0) {
			clearTimer();
			timer = setTimeout(flushInBackground, debounceMs);
		}
	}

	const page = typeof document === 'undefined' ? undefined : document;
	const browser = typeof window === 'undefined' ? undefined : window;
	function onVisibilityChange() {
		if (page?.visibilityState === 'hidden') flushInBackground();
	}
	page?.addEventListener('visibilitychange', onVisibilityChange);
	browser?.addEventListener('pagehide', flushInBackground);
	browser?.addEventListener('beforeunload', flushInBackground);

	function dispose(): Promise<void> {
		disposed = true;
		clearTimer();
		page?.removeEventListener('visibilitychange', onVisibilityChange);
		browser?.removeEventListener('pagehide', flushInBackground);
		browser?.removeEventListener('beforeunload', flushInBackground);
		return flush();
	}

	return { schedule, flush, dispose };
}
