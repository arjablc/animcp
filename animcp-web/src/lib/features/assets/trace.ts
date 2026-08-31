import type { PathData } from '../animation/model';
import { validatePath } from '../animation/validation';
import { ASSET_LIMITS, AssetError, throwIfAborted } from './limits';
import { assertRasterBlob } from './raster-input';
import {
	normalizeTraceOptions,
	reportProgress,
	type TraceOptions,
	type TraceProgress
} from './trace-algorithm';
import type { TraceRequest, TraceResponse } from './trace-protocol';

/**
 * Returns an uncommitted monochrome preview. The caller chooses whether to create/update a layer.
 * A dedicated worker is terminated on success, error, timeout, or AbortSignal cancellation.
 * No main-thread tracing fallback, persistence, external URL loading, or SVG parsing occurs.
 */
export async function traceRaster(
	blob: Blob,
	options: TraceOptions = {},
	signal?: AbortSignal,
	onProgress?: TraceProgress
): Promise<PathData> {
	throwIfAborted(signal);
	assertRasterBlob(blob);
	const settings = normalizeTraceOptions(options);
	if (typeof Worker !== 'function')
		throw new AssetError('unavailable', 'Raster tracing requires browser Web Workers.');
	let worker: Worker;
	try {
		worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' });
	} catch {
		throw new AssetError(
			'unavailable',
			'Unable to start the raster tracing worker. Check browser worker support and content security policy.'
		);
	}
	return new Promise((resolve, reject) => {
		let settled = false;
		let progress = 0;
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
			worker.terminate();
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onAbort = () => fail(new DOMException('Raster tracing canceled.', 'AbortError'));
		const timer = setTimeout(
			() => fail(new AssetError('timeout', 'Raster tracing timed out. Try a smaller image.')),
			ASSET_LIMITS.traceTimeoutMs
		);
		signal?.addEventListener('abort', onAbort, { once: true });
		worker.onerror = (event) => {
			event.preventDefault();
			fail(
				new AssetError('decode', 'The raster tracing worker failed. Try a smaller still image.')
			);
		};
		worker.onmessageerror = () =>
			fail(new AssetError('decode', 'Unable to read the raster tracing result.'));
		worker.onmessage = (event: MessageEvent<TraceResponse>) => {
			if (settled) return;
			const message = event.data;
			if (message.type === 'progress') {
				if (Number.isFinite(message.fraction)) {
					progress = Math.max(progress, Math.min(0.99, message.fraction));
					reportProgress(onProgress, progress);
				}
			} else if (message.type === 'error') {
				fail(new AssetError(message.code, message.message));
			} else if (message.type === 'result') {
				try {
					const path = validatePath(message.path);
					if (path.length > settings.maxCommands || path.some((command) => command.type === 'C')) {
						throw new AssetError(
							'complexity',
							'Worker output exceeds the supported monochrome path limits.'
						);
					}
					settled = true;
					cleanup();
					reportProgress(onProgress, 1);
					resolve(path);
				} catch (error) {
					fail(error);
				}
			} else {
				fail(new AssetError('decode', 'Unexpected raster tracing response.'));
			}
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		reportProgress(onProgress, 0);
		if (settled) return; // The progress observer may cancel immediately.
		try {
			worker.postMessage({ type: 'trace', blob, options: settings } satisfies TraceRequest);
		} catch {
			fail(new AssetError('decode', 'Unable to send the local raster to the worker.'));
		}
	});
}
