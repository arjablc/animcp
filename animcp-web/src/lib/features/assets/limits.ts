import { ANIMATION_LIMITS } from '../animation/model';

export const ASSET_LIMITS = Object.freeze({
	maxBytes: ANIMATION_LIMITS.maxAssetBytes,
	maxBase64Characters: 4 * Math.ceil(ANIMATION_LIMITS.maxAssetBytes / 3),
	// Budget the decoded RGBA surface, independently of the compressed file size.
	maxDecodedBytes: 10 * 1024 * 1024,
	maxDimension: 16_384,
	maxTraceDimension: 512,
	maxTraceCommands: Math.min(10_000, ANIMATION_LIMITS.maxPathCommands),
	decodeTimeoutMs: 15_000,
	traceTimeoutMs: 30_000
});

export type AssetErrorCode =
	| 'invalid-input'
	| 'unsupported-format'
	| 'size-limit'
	| 'decode'
	| 'unavailable'
	| 'complexity'
	| 'empty-trace'
	| 'timeout';

export class AssetError extends Error {
	constructor(
		readonly code: AssetErrorCode,
		message: string
	) {
		super(message);
		this.name = 'AssetError';
	}
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Asset operation canceled.', 'AbortError');
}

/** Detach listeners on every outcome; close a bitmap even if decoding finishes after cancel. */
export function abortable<T>(
	operation: Promise<T>,
	signal?: AbortSignal,
	discard?: (value: T) => void,
	timeoutMs = ASSET_LIMITS.decodeTimeoutMs
): Promise<T> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onAbort = () => fail(new DOMException('Asset operation canceled.', 'AbortError'));
		const timer = setTimeout(
			() => fail(new AssetError('timeout', 'Raster decoding timed out. Try a smaller image.')),
			timeoutMs
		);
		signal?.addEventListener('abort', onAbort, { once: true });
		operation.then((value) => {
			if (settled) {
				discard?.(value);
				return;
			}
			settled = true;
			cleanup();
			resolve(value);
		}, fail);
		if (signal?.aborted) onAbort();
	});
}
