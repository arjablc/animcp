import { validateProject, type Project } from './model';
const DB = 'animcp-motion-v2';
async function database(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
		req.onsuccess = () => {
			req.result.onversionchange = () => req.result.close();
			resolve(req.result);
		};
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error('Close other AniMCP tabs and retry storage'));
	});
}
async function operation<T>(
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await database();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('projects', mode);
		const req = fn(tx.objectStore('projects'));
		tx.oncomplete = () => {
			db.close();
			resolve(req.result);
		};
		tx.onabort = tx.onerror = () => {
			db.close();
			reject(tx.error ?? req.error ?? new Error('Local storage failed'));
		};
	});
}
export async function saveMotion(p: Project) {
	const value = validateProject(p);
	await operation('readwrite', (s) => s.put(value));
}
export async function loadMotion(id: string) {
	const p = await operation<Project | undefined>('readonly', (s) => s.get(id));
	return p ? validateProject(p) : undefined;
}
export async function listMotion() {
	return (await operation<Project[]>('readonly', (s) => s.getAll()))
		.map((p) => ({
			id: p.id,
			name: p.name,
			updatedAt: p.updatedAt,
			composition: p.composition,
			layerCount: p.layers.length
		}))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteMotion(id: string) {
	await operation('readwrite', (s) => s.delete(id));
}
