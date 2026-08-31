import { AssetError } from './limits';
import { decodeRaster } from './raster-input';
import { normalizeTraceOptions, tracePixels } from './trace-algorithm';
import type { TraceRequest, TraceResponse } from './trace-protocol';

// A small explicit worker scope avoids mixing Window and WebWorker ambient lib declarations.
const scope = self as unknown as {
	onmessage: ((event: MessageEvent<TraceRequest>) => void) | null;
	postMessage(message: TraceResponse): void;
};
let started = false;

scope.onmessage = (event) => {
	if (started || event.data.type !== 'trace') return;
	started = true;
	void run(event.data);
};

async function run(request: TraceRequest): Promise<void> {
	let bitmap: ImageBitmap | undefined;
	let canvas: OffscreenCanvas | undefined;
	try {
		const options = normalizeTraceOptions(request.options);
		if (typeof OffscreenCanvas !== 'function') {
			throw new AssetError(
				'unavailable',
				'This browser does not support tracing with OffscreenCanvas in a worker.'
			);
		}
		scope.postMessage({ type: 'progress', fraction: 0.02 });
		({ bitmap } = await decodeRaster(request.blob));
		const sourceWidth = bitmap.width;
		const sourceHeight = bitmap.height;
		const scale = Math.min(1, options.maxDimension / Math.max(sourceWidth, sourceHeight));
		const width = Math.max(1, Math.round(sourceWidth * scale));
		const height = Math.max(1, Math.round(sourceHeight * scale));
		canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context)
			throw new AssetError('unavailable', 'Unable to create the worker raster surface.');
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		bitmap = undefined;
		const pixels = context.getImageData(0, 0, width, height);
		const path = tracePixels(pixels, options, (fraction) => {
			scope.postMessage({ type: 'progress', fraction: 0.15 + 0.8 * fraction });
		});
		// One path may contain multiple M/L/Z contours. Keep coordinates in source-image space.
		for (const command of path) {
			if (command.type === 'M' || command.type === 'L') {
				command.x *= sourceWidth / width;
				command.y *= sourceHeight / height;
			}
		}
		scope.postMessage({ type: 'result', path });
	} catch (error) {
		scope.postMessage({
			type: 'error',
			code: error instanceof AssetError ? error.code : 'decode',
			message:
				error instanceof AssetError
					? error.message
					: 'Raster tracing failed. Try a smaller still image.'
		});
	} finally {
		bitmap?.close();
		if (canvas) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}
