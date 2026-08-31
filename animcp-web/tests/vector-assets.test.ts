import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import type { PathData } from '../src/lib/features/animation/model';
import { validateAsset, validatePath } from '../src/lib/features/animation/validation';
import {
	ASSET_LIMITS,
	decodeBase64Asset,
	inspectRaster,
	prepareRasterAsset,
	traceRaster
} from '../src/lib/features/assets/raster';
import { normalizeTraceOptions, tracePixels } from '../src/lib/features/assets/trace-algorithm';
import type { TraceRequest, TraceResponse } from '../src/lib/features/assets/trace-protocol';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
	const chunk = new Uint8Array(12 + data.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, data.length);
	chunk.set(new TextEncoder().encode(type), 4);
	chunk.set(data, 8);
	let crc = 0xffffffff;
	for (const byte of chunk.subarray(4, -4)) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
	return chunk;
}

// Full valid PNG at 1x1; alternate dimensions intentionally exercise pre-decode header limits.
function png(width = 1, height = 1, extra: Uint8Array[] = []): Uint8Array<ArrayBuffer> {
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	ihdr.set([8, 6, 0, 0, 0], 8);
	return new Uint8Array(
		Buffer.concat([
			new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
			pngChunk('IHDR', ihdr),
			...extra,
			pngChunk('IDAT', deflateSync(new Uint8Array([0, 0, 0, 0, 255]))),
			pngChunk('IEND', new Uint8Array())
		])
	);
}

// Container fixtures, not codec fixtures; browser decoding remains an independent required step.
function jpeg(width = 32, height = 24, marker = 0xc0): Uint8Array<ArrayBuffer> {
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		marker,
		0,
		11,
		8,
		height >> 8,
		height & 255,
		width >> 8,
		width & 255,
		1,
		1,
		0x11,
		0,
		0xff,
		0xda,
		0,
		8,
		1,
		1,
		0,
		0,
		63,
		0,
		0,
		0xff,
		0xd9
	]);
}

function webpChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
	const chunk = new Uint8Array(8 + data.length + (data.length % 2));
	chunk.set(new TextEncoder().encode(type));
	new DataView(chunk.buffer).setUint32(4, data.length, true);
	chunk.set(data, 8);
	return chunk;
}

function webp(width = 32, height = 24, lossless = true, extended = false): Uint8Array<ArrayBuffer> {
	const payload = lossless ? new Uint8Array(5) : new Uint8Array(10);
	if (lossless) {
		payload[0] = 0x2f;
		new DataView(payload.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
	} else {
		payload.set([0x10, 0, 0, 0x9d, 1, 0x2a]);
		const view = new DataView(payload.buffer);
		view.setUint16(6, width, true);
		view.setUint16(8, height, true);
	}
	const chunks = [webpChunk(lossless ? 'VP8L' : 'VP8 ', payload)];
	if (extended) {
		const x = new Uint8Array(10);
		x.set([width - 1, (width - 1) >> 8, 0, height - 1, (height - 1) >> 8, 0], 4);
		chunks.unshift(webpChunk('VP8X', x));
	}
	const bytes = new Uint8Array(12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	bytes.set(new TextEncoder().encode('RIFF'));
	new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
	bytes.set(new TextEncoder().encode('WEBP'), 8);
	let offset = 12;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

const pngBlob = () => new Blob([png()], { type: 'image/png' });
const transport = () => ({
	name: 'Pixel.png',
	mimeType: 'image/png',
	dataBase64: Buffer.from(png()).toString('base64')
});

describe('bounded raster signatures and dimensions', () => {
	it.each([
		['PNG', png(32, 24), 'image/png'],
		['baseline JPEG', jpeg(), 'image/jpeg'],
		['progressive JPEG', jpeg(32, 24, 0xc2), 'image/jpeg'],
		['lossy WebP', webp(32, 24, false), 'image/webp'],
		['lossless WebP', webp(), 'image/webp'],
		['extended WebP', webp(32, 24, true, true), 'image/webp']
	])('reads %s dimensions from signatures', (_name, bytes, mimeType) => {
		expect(inspectRaster(bytes as Uint8Array, mimeType as string)).toEqual({
			mimeType,
			width: 32,
			height: 24
		});
	});
	it('uses Uint8Array offsets, not the backing buffer origin', () => {
		const wrapped = new Uint8Array(png().length + 20);
		wrapped.set(png(), 7);
		expect(inspectRaster(wrapped.subarray(7, -13)).width).toBe(1);
	});
	it('rejects MIME spoofing, SVG, URLs, and unknown signatures', () => {
		expect(() => inspectRaster(png(), 'image/jpeg')).toThrow(/MIME/);
		for (const value of [
			'<svg onload="alert(1)"/>',
			'https://example.com/picture.png',
			'GIF89a',
			''
		]) {
			expect(() => inspectRaster(new TextEncoder().encode(value), 'image/png')).toThrow();
		}
		expect(() => inspectRaster(png(), 'image/svg+xml')).toThrow(/Only PNG/);
	});
	it('rejects every truncated prefix of each supported container without out-of-bounds reads', () => {
		for (const bytes of [png(), jpeg(), webp(), webp(32, 24, false)]) {
			for (let length = 0; length < bytes.length; length++) {
				expect(() => inspectRaster(bytes.subarray(0, length))).toThrow();
			}
		}
	});
	it('rejects overlong chunks and mismatched WebP container dimensions', () => {
		const p = png();
		new DataView(p.buffer).setUint32(33, 0xffffffff);
		expect(() => inspectRaster(p)).toThrow(/truncated/);
		const w = webp(32, 24, true, true);
		w[24] = 32;
		expect(() => inspectRaster(w)).toThrow(/dimensions disagree/);
	});
	it('rejects animated PNG and WebP rather than budgeting only one frame', () => {
		expect(() => inspectRaster(png(1, 1, [pngChunk('acTL', new Uint8Array(8))]))).toThrow(
			/Animated PNG/
		);
		const w = webp(32, 24, true, true);
		w[20] = 2;
		expect(() => inspectRaster(w)).toThrow(/Animated WebP/);
	});
	it('enforces independent file, decoded RGBA, and per-side budgets', () => {
		expect(inspectRaster(png(1280, 2048))).toMatchObject({ width: 1280, height: 2048 });
		expect(inspectRaster(png(16384, 1)).width).toBe(16384);
		for (const bytes of [
			png(1281, 2048),
			png(16385, 1),
			png(0, 1),
			jpeg(65535, 65535),
			webp(4096, 4096)
		]) {
			expect(() => inspectRaster(bytes)).toThrow();
		}
		expect(() => inspectRaster(new Uint8Array(ASSET_LIMITS.maxBytes + 1))).toThrow(/10 MiB/);
	});
});

describe('base64 import boundary', () => {
	it('accepts the current WebMCP envelope without encoding and does not return its payload', async () => {
		const input = { ...transport(), expectedRevision: 0, requestId: 'request-1' };
		const result = decodeBase64Asset(input);
		expect(Object.keys(result).sort()).toEqual(['blob', 'name']);
		expect(result.name).toBe(input.name);
		expect(result.blob.type).toBe('image/png');
		expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(png());
	});
	it('also accepts the explicit base64 transport, but rejects mixed/incorrect encoding', () => {
		const { dataBase64, ...rest } = transport();
		expect(decodeBase64Asset({ ...rest, encoding: 'base64', data: dataBase64 }).blob.size).toBe(
			png().length
		);
		for (const input of [
			{ ...rest, data: dataBase64 },
			{ ...rest, encoding: 'hex', data: dataBase64 },
			{ ...transport(), encoding: 'base64' },
			{ ...transport(), data: dataBase64 }
		]) {
			expect(() => decodeBase64Asset(input)).toThrow();
		}
	});
	it.each([
		'',
		'A',
		'AAA',
		'A===',
		'AA=A',
		'====',
		'AA==\n',
		'A A=',
		'AA-_',
		'AB==',
		'AAF=',
		'data:image/png;base64,AA==',
		'https://example.com/a.png'
	])('rejects malformed or noncanonical base64: %s', (dataBase64) => {
		expect(() => decodeBase64Asset({ ...transport(), dataBase64 })).toThrow();
	});
	it('rejects oversize encoded and decoded lengths before atob allocates', () => {
		const decode = vi.spyOn(globalThis, 'atob');
		for (const dataBase64 of [
			'A'.repeat(ASSET_LIMITS.maxBase64Characters + 4),
			'A'.repeat(ASSET_LIMITS.maxBase64Characters),
			'A'.repeat(ASSET_LIMITS.maxBase64Characters - 1) + '='
		]) {
			expect(() => decodeBase64Asset({ ...transport(), dataBase64 })).toThrow(/10 MiB/);
		}
		expect(decode).not.toHaveBeenCalled();
	});
	it('accepts a signature-checked payload at exactly the 10 MiB byte limit', () => {
		const text = new Uint8Array(ASSET_LIMITS.maxBytes - png().length - 12).fill(97);
		text[8] = 0; // A valid PNG text keyword followed by its separator and text.
		const bytes = png(1, 1, [pngChunk('tEXt', text)]);
		expect(bytes.length).toBe(ASSET_LIMITS.maxBytes);
		const { blob } = decodeBase64Asset({
			...transport(),
			dataBase64: Buffer.from(bytes).toString('base64')
		});
		expect(blob.size).toBe(ASSET_LIMITS.maxBytes);
	});
	it('rejects unknown fields, invalid metadata, malformed inputs, and accessor execution', () => {
		for (const input of [
			null,
			[],
			'AA==',
			{ ...transport(), url: 'https://example.com' },
			{ ...transport(), name: ' ' },
			{ ...transport(), name: 'x'.repeat(201) },
			{ ...transport(), name: 'a\nb' },
			{ ...transport(), expectedRevision: -1 },
			{ ...transport(), requestId: {} },
			{ ...transport(), mimeType: 'image/svg+xml' },
			{ ...transport(), mimeType: 'image/jpeg' }
		]) {
			expect(() => decodeBase64Asset(input)).toThrow();
		}
		const getter = vi.fn(() => 'AA==');
		const input = { ...transport() };
		Object.defineProperty(input, 'dataBase64', { get: getter, enumerable: true });
		expect(() => decodeBase64Asset(input)).toThrow(/Accessors/);
		expect(getter).not.toHaveBeenCalled();
	});
	it('applies signature and decompression budget checks to base64', () => {
		for (const bytes of [new TextEncoder().encode('<svg/>'), png(8192, 8192)]) {
			expect(() =>
				decodeBase64Asset({ ...transport(), dataBase64: Buffer.from(bytes).toString('base64') })
			).toThrow();
		}
	});
});

describe('browser decode and resource lifecycle', () => {
	it('returns canonical metadata and closes the decoded bitmap without creating an object URL', async () => {
		const close = vi.fn();
		vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }));
		const objectUrl = vi.spyOn(URL, 'createObjectURL');
		const input = new File([png()], ' Pixel.png '); // Empty MIME is inferred, then normalized.
		const result = await prepareRasterAsset(input, input.name);
		expect(result.blob.type).toBe('image/png');
		expect(result.asset).toEqual(validateAsset(result.asset));
		expect(result.asset).toMatchObject({
			name: 'Pixel.png',
			kind: 'raster',
			source: 'file',
			width: 1,
			height: 1,
			byteLength: png().length,
			blobKey: result.asset.id
		});
		expect(close).toHaveBeenCalledOnce();
		expect(objectUrl).not.toHaveBeenCalled();
	});
	it('blocks unsafe bytes and headers before calling the decoder', async () => {
		const decoder = vi.fn();
		vi.stubGlobal('createImageBitmap', decoder);
		for (const blob of [
			new Blob([png(8192, 8192)], { type: 'image/png' }),
			new Blob([png()], { type: 'image/jpeg' }),
			new Blob(['<svg/>'], { type: 'image/png' }),
			new Blob([new Uint8Array(ASSET_LIMITS.maxBytes + 1)], { type: 'image/png' })
		]) {
			await expect(prepareRasterAsset(blob, 'bad.png')).rejects.toThrow();
		}
		await expect(
			prepareRasterAsset('https://example.com' as unknown as Blob, 'bad.png')
		).rejects.toThrow(/File or Blob/);
		expect(decoder).not.toHaveBeenCalled();
	});
	it('rejects codec errors and unavailable decoder support', async () => {
		vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('codec error')));
		await expect(prepareRasterAsset(pngBlob(), 'bad.png')).rejects.toMatchObject({
			code: 'decode'
		});
		vi.stubGlobal('createImageBitmap', undefined);
		await expect(prepareRasterAsset(pngBlob(), 'bad.png')).rejects.toMatchObject({
			code: 'unavailable'
		});
	});
	it('closes and rejects mismatched or over-budget decoded surfaces', async () => {
		for (const [width, height] of [
			[2, 3],
			[8192, 8192]
		]) {
			const close = vi.fn();
			vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }));
			await expect(prepareRasterAsset(pngBlob(), 'bad.png')).rejects.toThrow();
			expect(close).toHaveBeenCalledOnce();
		}
	});
	it('accepts decoder EXIF orientation swaps and records the decoded dimensions', async () => {
		const close = vi.fn();
		vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 24, height: 32, close }));
		const { asset } = await prepareRasterAsset(
			new Blob([jpeg()], { type: 'image/jpeg' }),
			'portrait.jpg',
			'webmcp'
		);
		expect(asset).toMatchObject({ width: 24, height: 32, source: 'webmcp' });
		expect(close).toHaveBeenCalledOnce();
	});
	it('rejects a pre-aborted import without decoding', async () => {
		const decoder = vi.fn();
		vi.stubGlobal('createImageBitmap', decoder);
		const controller = new AbortController();
		controller.abort();
		await expect(
			prepareRasterAsset(pngBlob(), 'Pixel.png', 'file', controller.signal)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(decoder).not.toHaveBeenCalled();
	});
	it('closes a bitmap that arrives after cancellation', async () => {
		let finish!: (bitmap: unknown) => void;
		const decoder = vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		vi.stubGlobal('createImageBitmap', decoder);
		const controller = new AbortController();
		const promise = prepareRasterAsset(pngBlob(), 'Pixel.png', 'file', controller.signal);
		const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		await vi.waitFor(() => expect(decoder).toHaveBeenCalledOnce());
		controller.abort();
		await rejected;
		const close = vi.fn();
		finish({ width: 1, height: 1, close });
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
	});
	it('bounds a stalled decode with a timeout and closes its eventual bitmap', async () => {
		vi.useFakeTimers();
		let finish!: (bitmap: unknown) => void;
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					})
			)
		);
		const rejected = expect(prepareRasterAsset(pngBlob(), 'Pixel.png')).rejects.toMatchObject({
			code: 'timeout'
		});
		await vi.advanceTimersByTimeAsync(ASSET_LIMITS.decodeTimeoutMs);
		await rejected;
		const close = vi.fn();
		finish({ width: 1, height: 1, close });
		await Promise.resolve();
		expect(close).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
});

function pixels(width: number, height: number, filled: (x: number, y: number) => boolean) {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = filled(x, y) ? 255 : 0;
	return { data, width, height };
}

function contours(path: PathData): { x: number; y: number }[][] {
	const result: { x: number; y: number }[][] = [];
	for (const command of path) {
		if (command.type === 'M') result.push([{ x: command.x, y: command.y }]);
		else if (command.type === 'L') result.at(-1)!.push({ x: command.x, y: command.y });
		else expect(command.type).toBe('Z');
	}
	return result;
}

function signedAreas(path: PathData): number[] {
	return contours(path).map(
		(points) =>
			points.reduce((sum, point, i) => {
				const next = points[(i + 1) % points.length];
				return sum + point.x * next.y - next.x * point.y;
			}, 0) / 2
	);
}

function filledAt(path: PathData, x: number, y: number): boolean {
	let winding = 0;
	for (const points of contours(path))
		for (let i = 0; i < points.length; i++) {
			const a = points[i];
			const b = points[(i + 1) % points.length];
			const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
			if (a.y <= y && b.y > y && side > 0) winding++;
			if (a.y > y && b.y <= y && side < 0) winding--;
		}
	return winding !== 0;
}

describe('pure monochrome contour tracing', () => {
	it('simplifies a 512px rectangle to four corners and Z', () => {
		const path = tracePixels(pixels(512, 512, () => true));
		expect(path).toEqual([
			{ type: 'M', x: 0, y: 0 },
			{ type: 'L', x: 512, y: 0 },
			{ type: 'L', x: 512, y: 512 },
			{ type: 'L', x: 0, y: 512 },
			{ type: 'Z' }
		]);
		expect(validatePath(path)).toEqual(path);
	});
	it('preserves holes through opposite winding in one canonical path', () => {
		const path = tracePixels(pixels(5, 5, (x, y) => x === 0 || y === 0 || x === 4 || y === 4));
		expect(path).toHaveLength(10);
		expect(signedAreas(path)).toEqual([25, -9]);
		expect(filledAt(path, 2.5, 2.5)).toBe(false);
	});
	it('keeps diagonally touching pixels as distinct contours', () => {
		const path = tracePixels(pixels(2, 2, (x, y) => x === y));
		expect(signedAreas(path)).toEqual([1, 1]);
		expect(path).toHaveLength(10);
	});
	it('round-trips the foreground of all 511 nonempty 3x3 masks under nonzero fill', () => {
		for (let mask = 1; mask < 512; mask++) {
			const image = pixels(3, 3, (x, y) => Boolean(mask & (1 << (y * 3 + x))));
			const path = tracePixels(image);
			expect(validatePath(path)).toEqual(path);
			for (let y = 0; y < 3; y++)
				for (let x = 0; x < 3; x++) {
					expect(filledAt(path, x + 0.5, y + 0.5), `mask=${mask}, pixel=${x},${y}`).toBe(
						Boolean(mask & (1 << (y * 3 + x)))
					);
				}
			expect(signedAreas(path).reduce((sum, area) => sum + area, 0)).toBe(
				image.data.filter((byte) => byte === 255).length
			);
		}
	});
	it('uses alpha and luma thresholds, inversion, and color-independent alpha mode', () => {
		const image = {
			width: 4,
			height: 1,
			data: new Uint8ClampedArray([
				0, 0, 0, 0, 0, 0, 0, 127, 128, 128, 128, 128, 255, 255, 255, 255
			])
		};
		expect(tracePixels(image)[0]).toEqual({ type: 'M', x: 2, y: 0 });
		expect(tracePixels(image, { invert: true })[0]).toEqual({ type: 'M', x: 3, y: 0 });
		expect(signedAreas(tracePixels(image, { mode: 'alpha' }))).toEqual([2]);
		expect(signedAreas(tracePixels(image, { mode: 'alpha', alphaThreshold: 0 }))).toEqual([3]);
	});
	it('rejects empty masks without returning an invalid empty path', () => {
		expect(() => tracePixels(pixels(1, 1, () => false))).toThrow(/No foreground/);
	});
	it('accepts exactly 10000 commands and rejects excess complexity without partial output', () => {
		expect(tracePixels(pixels(80, 100, (x, y) => x % 2 === 0 && y % 2 === 0))).toHaveLength(10000);
		expect(() => tracePixels(pixels(82, 100, (x, y) => x % 2 === 0 && y % 2 === 0))).toThrow(
			/exceeds 10000 commands after simplification/
		);
		expect(() =>
			tracePixels(
				pixels(2, 2, (x, y) => x === y),
				{ maxCommands: 5 }
			)
		).toThrow(/exceeds 5 commands/);
	});
	it('cannot raise dimension or command caps and rejects malformed options and pixels', () => {
		for (const options of [
			{ maxDimension: 513 },
			{ maxCommands: 10001 },
			{ threshold: NaN },
			{ alphaThreshold: -1 },
			{ threshold: 0.5 },
			{ mode: 'color' },
			{ invert: 1 }
		]) {
			expect(() => normalizeTraceOptions(options as never)).toThrow();
		}
		expect(() => tracePixels(pixels(513, 1, () => true))).toThrow(/512/);
		expect(() => tracePixels({ width: 2, height: 2, data: new Uint8Array(4) })).toThrow(/RGBA/);
	});
	it('is deterministic, leaves pixels untouched, and reports bounded monotonic progress', () => {
		const image = pixels(512, 512, (x, y) => x % 3 === 0 && y < 8);
		const before = image.data.slice();
		const progress: number[] = [];
		const path = tracePixels(image, {}, (fraction) => progress.push(fraction));
		expect(tracePixels(image)).toEqual(path);
		expect(image.data).toEqual(before);
		expect(progress[0]).toBe(0);
		expect(progress.at(-1)).toBe(1);
		expect(
			progress.every(
				(value, i) => value >= 0 && value <= 1 && (i === 0 || value >= progress[i - 1])
			)
		).toBe(true);
		expect(progress.length).toBeLessThan(200);
	});
});

class FakeWorker {
	static instances: FakeWorker[] = [];
	onmessage: ((event: MessageEvent<TraceResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	postMessage = vi.fn<(message: TraceRequest) => void>();
	terminate = vi.fn();
	constructor(
		readonly url: URL,
		readonly options: WorkerOptions
	) {
		FakeWorker.instances.push(this);
	}
	send(data: TraceResponse) {
		this.onmessage?.(new MessageEvent('message', { data }));
	}
}

function installWorker() {
	FakeWorker.instances = [];
	vi.stubGlobal('Worker', FakeWorker);
	return () => FakeWorker.instances.at(-1)!;
}

describe('worker trace API', () => {
	it('uses the module worker, returns a preview, and cleans up on success', async () => {
		const current = installWorker();
		const progress: number[] = [];
		const blob = pngBlob();
		const promise = traceRaster(blob, {}, undefined, (fraction) => progress.push(fraction));
		const worker = current();
		expect(worker.url.pathname).toMatch(/trace\.worker\.ts$/);
		expect(worker.options.type).toBe('module');
		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ blob, type: 'trace' })
		);
		worker.send({ type: 'progress', fraction: 0.6 });
		worker.send({ type: 'progress', fraction: 0.2 });
		const path = tracePixels(pixels(1, 1, () => true));
		worker.send({ type: 'result', path });
		expect(await promise).toEqual(path);
		expect(progress).toEqual([0, 0.6, 0.6, 1]);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
		expect(worker.onerror).toBeNull();
	});
	it('terminates immediately on cancellation, with no partial path', async () => {
		const current = installWorker();
		const controller = new AbortController();
		const promise = traceRaster(pngBlob(), {}, controller.signal);
		controller.abort();
		await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
		expect(current().terminate).toHaveBeenCalledOnce();
	});
	it('does not start work if aborted before or during the initial progress callback', async () => {
		const current = installWorker();
		const controller = new AbortController();
		controller.abort();
		await expect(traceRaster(pngBlob(), {}, controller.signal)).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(FakeWorker.instances).toHaveLength(0);
		const other = new AbortController();
		await expect(
			traceRaster(pngBlob(), {}, other.signal, () => other.abort())
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(current().postMessage).not.toHaveBeenCalled();
		expect(current().terminate).toHaveBeenCalledOnce();
	});
	it('propagates actionable worker failures and terminates', async () => {
		const current = installWorker();
		const promise = traceRaster(pngBlob());
		current().send({ type: 'error', code: 'complexity', message: 'Reduce maxDimension.' });
		await expect(promise).rejects.toMatchObject({
			code: 'complexity',
			message: 'Reduce maxDimension.'
		});
		expect(current().terminate).toHaveBeenCalledOnce();
	});
	it('rejects unsupported workers and malformed worker results', async () => {
		vi.stubGlobal('Worker', undefined);
		await expect(traceRaster(pngBlob())).rejects.toMatchObject({ code: 'unavailable' });
		const current = installWorker();
		const promise = traceRaster(pngBlob());
		current().send({ type: 'result', path: [] });
		await expect(promise).rejects.toThrow(/path/i);
		expect(current().terminate).toHaveBeenCalledOnce();
	});
	it('timeouts terminate the worker and remove timers', async () => {
		vi.useFakeTimers();
		const current = installWorker();
		const rejected = expect(traceRaster(pngBlob())).rejects.toMatchObject({ code: 'timeout' });
		await vi.advanceTimersByTimeAsync(ASSET_LIMITS.traceTimeoutMs);
		await rejected;
		expect(current().terminate).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('cleans up startup/message failures and ignores failing progress observers', async () => {
		const current = installWorker();
		const failed = traceRaster(pngBlob());
		const preventDefault = vi.fn();
		current().onerror?.({ preventDefault } as unknown as ErrorEvent);
		await expect(failed).rejects.toMatchObject({ code: 'decode' });
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(current().terminate).toHaveBeenCalledOnce();

		const messageFailed = traceRaster(pngBlob());
		current().onmessageerror?.();
		await expect(messageFailed).rejects.toMatchObject({ code: 'decode' });
		expect(current().terminate).toHaveBeenCalledOnce();

		const success = traceRaster(pngBlob(), {}, undefined, () => {
			throw new Error('UI observer failed');
		});
		const path = tracePixels(pixels(1, 1, () => true));
		current().send({ type: 'result', path });
		await expect(success).resolves.toEqual(path);
		expect(current().terminate).toHaveBeenCalledOnce();
	});
});

describe('worker decode, sampling and tracing pipeline', () => {
	async function workerScope() {
		vi.resetModules();
		const scope = {
			onmessage: null as ((event: MessageEvent<TraceRequest>) => void) | null,
			postMessage: vi.fn<(response: TraceResponse) => void>()
		};
		vi.stubGlobal('self', scope);
		await import('../src/lib/features/assets/trace.worker');
		return scope;
	}

	it('samples within 512px, scales contours to source coordinates, and releases decoder/canvas', async () => {
		const close = vi.fn();
		vi.stubGlobal(
			'createImageBitmap',
			vi.fn().mockResolvedValue({ width: 1024, height: 256, close })
		);
		const drawImage = vi.fn();
		const sampled: number[][] = [];
		const canvases: { width: number; height: number }[] = [];
		vi.stubGlobal(
			'OffscreenCanvas',
			class {
				constructor(
					public width: number,
					public height: number
				) {
					canvases.push(this);
				}
				getContext() {
					return {
						drawImage,
						getImageData: (_x: number, _y: number, width: number, height: number) => {
							sampled.push([width, height]);
							return pixels(width, height, () => true);
						}
					};
				}
			}
		);
		const scope = await workerScope();
		const blob = new Blob([png(1024, 256)], { type: 'image/png' });
		scope.onmessage!(new MessageEvent('message', { data: { type: 'trace', blob, options: {} } }));
		await vi.waitFor(() =>
			expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result' }))
		);
		expect(sampled).toEqual([[512, 128]]);
		expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 128);
		const message = scope.postMessage.mock.calls
			.map(([value]) => value)
			.find((value) => value.type === 'result');
		expect(message).toEqual({
			type: 'result',
			path: [
				{ type: 'M', x: 0, y: 0 },
				{ type: 'L', x: 1024, y: 0 },
				{ type: 'L', x: 1024, y: 256 },
				{ type: 'L', x: 0, y: 256 },
				{ type: 'Z' }
			]
		});
		expect(close).toHaveBeenCalledOnce();
		expect(canvases[0]).toMatchObject({ width: 1, height: 1 });
	});
	it('reports unavailable worker canvas support without decoding the image', async () => {
		vi.stubGlobal('OffscreenCanvas', undefined);
		const decode = vi.fn();
		vi.stubGlobal('createImageBitmap', decode);
		const scope = await workerScope();
		scope.onmessage!(
			new MessageEvent('message', { data: { type: 'trace', blob: pngBlob(), options: {} } })
		);
		await vi.waitFor(() =>
			expect(scope.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'error', code: 'unavailable' })
			)
		);
		expect(decode).not.toHaveBeenCalled();
	});
});
