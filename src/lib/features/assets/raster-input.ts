import { ANIMATION_LIMITS, type AssetRecord } from '../animation/model';
import { validateObject } from '../animation/validation';
import { abortable, ASSET_LIMITS, AssetError, throwIfAborted } from './limits';

export type RasterMimeType = 'image/png' | 'image/jpeg' | 'image/webp';
export type RasterHeader = { mimeType: RasterMimeType; width: number; height: number };
const rasterTypes: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];
const maxChunks = 4096;

function invalid(message = 'Invalid or truncated raster file.'): never {
	throw new AssetError('invalid-input', message);
}

function checkMime(value: string): void {
	if (value && !rasterTypes.includes(value)) {
		throw new AssetError(
			'unsupported-format',
			'Only PNG, JPEG, and WebP raster images are accepted.'
		);
	}
}

export function assertRasterBlob(blob: Blob): void {
	if (!(blob instanceof Blob)) invalid('Raster data must be a local File or Blob, not a URL.');
	if (!blob.size || blob.size > ASSET_LIMITS.maxBytes) {
		throw new AssetError('size-limit', 'Raster file size must be between 1 byte and 10 MiB.');
	}
	checkMime(blob.type);
}

export function assertRasterDimensions(width: number, height: number): void {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
		invalid('Raster dimensions must be positive integers.');
	}
	if (
		width > ASSET_LIMITS.maxDimension ||
		height > ASSET_LIMITS.maxDimension ||
		width * height * 4 > ASSET_LIMITS.maxDecodedBytes
	) {
		throw new AssetError(
			'size-limit',
			'Raster dimensions exceed the 10 MiB decoded RGBA budget (or 16384px per side).'
		);
	}
}

function fourCC(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function pngHeader(bytes: Uint8Array, view: DataView): RasterHeader {
	if (bytes.length < 33 || view.getUint32(8) !== 13 || fourCC(bytes, 12) !== 'IHDR') invalid();
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	assertRasterDimensions(width, height);
	const depths: Record<number, readonly number[]> = {
		0: [1, 2, 4, 8, 16],
		2: [8, 16],
		3: [1, 2, 4, 8],
		4: [8, 16],
		6: [8, 16]
	};
	if (
		!depths[bytes[25]]?.includes(bytes[24]) ||
		bytes[26] !== 0 ||
		bytes[27] !== 0 ||
		bytes[28] > 1
	)
		invalid();
	let offset = 8;
	let imageData = false;
	for (let count = 0; count < maxChunks && offset + 12 <= bytes.length; count++) {
		const length = view.getUint32(offset);
		const type = fourCC(bytes, offset + 4);
		const end = offset + 12 + length;
		if (end > bytes.length) invalid();
		if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
			throw new AssetError(
				'unsupported-format',
				'Animated PNG is not supported. Import a still frame.'
			);
		}
		if (type === 'IHDR' && offset !== 8) invalid();
		if (type === 'IDAT' && length > 0) imageData = true;
		if (type === 'IEND') {
			if (length !== 0 || end !== bytes.length || !imageData) invalid();
			return { mimeType: 'image/png', width, height };
		}
		offset = end;
	}
	invalid('PNG is truncated or exceeds the container complexity limit.');
}

function jpegHeader(bytes: Uint8Array, view: DataView): RasterHeader {
	if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
		invalid();
	let offset = 2;
	let header: RasterHeader | undefined;
	for (let count = 0; count < maxChunks && offset < bytes.length; count++) {
		if (bytes[offset++] !== 0xff) invalid();
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xd9 || marker === 0xd8 || marker === 0 || marker === undefined) invalid();
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
		if (offset + 2 > bytes.length) invalid();
		const length = view.getUint16(offset);
		if (length < 2 || offset + length > bytes.length) invalid();
		if (marker === 0xda) {
			if (!header || length < 6) invalid();
			return header;
		}
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			if (![0xc0, 0xc1, 0xc2].includes(marker)) {
				throw new AssetError(
					'unsupported-format',
					'This JPEG encoding is not supported. Use baseline or progressive JPEG.'
				);
			}
			if (header || length < 11 || bytes[offset + 2] !== 8) invalid();
			const components = bytes[offset + 7];
			if (![1, 3, 4].includes(components) || length !== 8 + components * 3) invalid();
			const width = view.getUint16(offset + 5);
			const height = view.getUint16(offset + 3);
			assertRasterDimensions(width, height);
			header = { mimeType: 'image/jpeg', width, height };
		}
		offset += length;
	}
	invalid('JPEG is truncated or exceeds the container complexity limit.');
}

function webpHeader(bytes: Uint8Array, view: DataView): RasterHeader {
	if (view.getUint32(4, true) + 8 !== bytes.length) invalid();
	let offset = 12;
	let extended: { width: number; height: number } | undefined;
	let image: { width: number; height: number } | undefined;
	const uint24 = (start: number) =>
		bytes[start] + bytes[start + 1] * 256 + bytes[start + 2] * 65536;
	for (let count = 0; offset < bytes.length && count < maxChunks; count++) {
		if (offset + 8 > bytes.length) invalid();
		const type = fourCC(bytes, offset);
		const length = view.getUint32(offset + 4, true);
		const start = offset + 8;
		const end = start + length + (length % 2);
		if (end > bytes.length) invalid();
		if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && length > 0 && bytes[start] & 2)) {
			throw new AssetError(
				'unsupported-format',
				'Animated WebP is not supported. Import a still frame.'
			);
		}
		if (type === 'VP8X') {
			if (
				offset !== 12 ||
				length !== 10 ||
				bytes[start] & 0xc1 ||
				bytes[start + 1] ||
				bytes[start + 2] ||
				bytes[start + 3]
			)
				invalid();
			extended = { width: uint24(start + 4) + 1, height: uint24(start + 7) + 1 };
			assertRasterDimensions(extended.width, extended.height);
		} else if (type === 'VP8 ') {
			if (
				image ||
				length < 10 ||
				bytes[start] & 1 ||
				bytes[start + 3] !== 0x9d ||
				bytes[start + 4] !== 0x01 ||
				bytes[start + 5] !== 0x2a
			)
				invalid();
			image = {
				width: view.getUint16(start + 6, true) & 0x3fff,
				height: view.getUint16(start + 8, true) & 0x3fff
			};
		} else if (type === 'VP8L') {
			if (image || length < 5 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0) invalid();
			const packed = view.getUint32(start + 1, true);
			image = { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
		}
		offset = end;
	}
	if (offset !== bytes.length || !image) invalid();
	assertRasterDimensions(image.width, image.height);
	if (extended && (extended.width !== image.width || extended.height !== image.height))
		invalid('WebP canvas and bitstream dimensions disagree.');
	return { mimeType: 'image/webp', ...image };
}

/** Bounded signature/container checks before any browser image decode. This is not a codec. */
export function inspectRaster(bytes: Uint8Array, claimedMime = ''): RasterHeader {
	if (
		!(bytes instanceof Uint8Array) ||
		!bytes.byteLength ||
		bytes.byteLength > ASSET_LIMITS.maxBytes
	) {
		throw new AssetError('size-limit', 'Raster file size must be between 1 byte and 10 MiB.');
	}
	checkMime(claimedMime);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let header: RasterHeader;
	if (bytes.length >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
		header = pngHeader(bytes, view);
	} else if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		header = jpegHeader(bytes, view);
	} else if (bytes.length >= 12 && fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP') {
		header = webpHeader(bytes, view);
	} else {
		throw new AssetError(
			'unsupported-format',
			'File signature is not PNG, JPEG, or WebP. SVG and external URLs are not accepted.'
		);
	}
	if (claimedMime && claimedMime !== header.mimeType)
		invalid('Claimed MIME type does not match the raster signature.');
	return header;
}

function assetName(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > ANIMATION_LIMITS.maxNameLength ||
		[...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
	) {
		invalid(
			`Asset name must contain 1-${ANIMATION_LIMITS.maxNameLength} characters without control characters.`
		);
	}
	return value.trim();
}

/** Strict raw RFC 4648 base64, never a data URL or a remote reference. No persistence here. */
export function decodeBase64Asset(input: unknown): { blob: Blob; name: string } {
	const value = validateObject(
		input,
		['encoding', 'mimeType', 'data', 'dataBase64', 'name', 'expectedRevision', 'requestId'],
		'asset'
	);
	const webmcp = Object.hasOwn(value, 'dataBase64');
	if (
		webmcp
			? Object.hasOwn(value, 'encoding') || Object.hasOwn(value, 'data')
			: value.encoding !== 'base64'
	) {
		invalid('Use dataBase64, or encoding: base64 with data; do not mix the two transport shapes.');
	}
	// The adapter may pass its full command envelope. These fields never authorize persistence.
	if (
		Object.hasOwn(value, 'expectedRevision') &&
		(typeof value.expectedRevision !== 'number' ||
			!Number.isSafeInteger(value.expectedRevision) ||
			value.expectedRevision < 0)
	)
		invalid('Invalid expectedRevision.');
	if (Object.hasOwn(value, 'requestId')) assetName(value.requestId);
	if (typeof value.mimeType !== 'string' || !rasterTypes.includes(value.mimeType)) {
		throw new AssetError(
			'unsupported-format',
			'Base64 MIME type must be image/png, image/jpeg, or image/webp.'
		);
	}
	const name = assetName(value.name);
	const data = webmcp ? value.dataBase64 : value.data;
	if (typeof data !== 'string' || !data.length)
		invalid('Asset data must be a nonempty base64 string.');
	// Check length before scanning or allocating a decoded buffer (regex repetition can overflow).
	if (data.length > ASSET_LIMITS.maxBase64Characters) {
		throw new AssetError('size-limit', 'Base64 asset exceeds the 10 MiB file limit.');
	}
	if (data.length % 4 !== 0) invalid('Base64 must use standard alphabet and canonical padding.');
	const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
	const decodedLength = (data.length / 4) * 3 - padding;
	if (decodedLength > ASSET_LIMITS.maxBytes)
		throw new AssetError('size-limit', 'Base64 asset exceeds the 10 MiB file limit.');
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let last = 0;
	for (let i = 0; i < data.length - padding; i++) {
		last = alphabet.indexOf(data[i]);
		if (last < 0) invalid('Base64 must use standard alphabet and canonical padding.');
	}
	if ((padding === 2 && last & 15) || (padding === 1 && last & 3))
		invalid('Base64 has nonzero padding bits.');
	let decoded: string;
	try {
		decoded = atob(data);
	} catch {
		invalid('Malformed base64 data.');
	}
	const bytes = new Uint8Array(decodedLength);
	for (let i = 0; i < bytes.length; i++) bytes[i] = decoded.charCodeAt(i);
	inspectRaster(bytes, value.mimeType);
	return { blob: new Blob([bytes], { type: value.mimeType }), name };
}

/** Shared by import and the worker; only bounded local bytes reach createImageBitmap. */
export async function decodeRaster(
	blob: Blob,
	signal?: AbortSignal
): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
	throwIfAborted(signal);
	assertRasterBlob(blob);
	const bytes = new Uint8Array(await abortable(blob.arrayBuffer(), signal));
	throwIfAborted(signal);
	const header = inspectRaster(bytes, blob.type);
	const normalized =
		blob.type === header.mimeType ? blob : blob.slice(0, blob.size, header.mimeType);
	if (typeof createImageBitmap !== 'function') {
		throw new AssetError(
			'unavailable',
			'This browser does not support safe local bitmap decoding.'
		);
	}
	let bitmap: ImageBitmap;
	try {
		bitmap = await abortable(createImageBitmap(normalized), signal, (late) => late.close());
	} catch (error) {
		if (
			error instanceof AssetError ||
			(error instanceof DOMException && error.name === 'AbortError')
		)
			throw error;
		throw new AssetError(
			'decode',
			'The browser could not decode this raster. Try exporting it as a new PNG, JPEG, or WebP.'
		);
	}
	try {
		throwIfAborted(signal);
		assertRasterDimensions(bitmap.width, bitmap.height);
		// EXIF orientation may exchange the dimensions; it cannot change the pixel budget.
		if (!(
			(bitmap.width === header.width && bitmap.height === header.height) ||
			(bitmap.width === header.height && bitmap.height === header.width)
		)) {
			invalid('Decoded dimensions do not match the raster header.');
		}
		return { blob: normalized, bitmap };
	} catch (error) {
		bitmap.close();
		throw error;
	}
}

/** Returns validated metadata + Blob. The caller owns putAsset(projectId, asset.id, blob). */
export async function prepareRasterAsset(
	blob: Blob,
	name: string,
	source: AssetRecord['source'] = 'file',
	signal?: AbortSignal
): Promise<{ asset: AssetRecord; blob: Blob }> {
	throwIfAborted(signal);
	const normalizedName = assetName(name);
	if (!['file', 'webmcp', 'vectorized'].includes(source)) invalid('Invalid asset source.');
	const decoded = await decodeRaster(blob, signal);
	try {
		throwIfAborted(signal);
		const id = `asset_${globalThis.crypto.randomUUID()}`;
		return {
			asset: {
				id,
				name: normalizedName,
				kind: 'raster',
				mimeType: decoded.blob.type as RasterMimeType,
				width: decoded.bitmap.width,
				height: decoded.bitmap.height,
				byteLength: decoded.blob.size,
				source,
				blobKey: id,
				createdAt: new Date().toISOString()
			},
			blob: decoded.blob
		};
	} finally {
		decoded.bitmap.close();
	}
}
