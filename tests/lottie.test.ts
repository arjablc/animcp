import { describe, expect, it } from 'vitest';
import {
	buildRasterLottie,
	validateExportSettings,
	validateNativeLottie
} from '../src/lib/features/export/lottie';
import type { ExportSettings } from '../src/lib/features/projects/project';

const vector: ExportSettings = { durationSeconds: 2, frameRate: 12, lottieMode: 'vector' };
const raster: ExportSettings = { ...vector, lottieMode: 'raster' };

describe('Lottie export', () => {
	it('validates native document timing and bounds', () => {
		const document = { v: '5.12.2', fr: 12, ip: 0, op: 24, w: 320, h: 240, assets: [], layers: [] };
		expect(validateNativeLottie(document, vector)).toBe(document);
		expect(() => validateNativeLottie({ ...document, op: 23 }, vector)).toThrow('timing');
	});

	it('builds one embedded image layer per raster frame', () => {
		const frames = Array.from({ length: 24 }, (_, index) => `data:image/png;base64,frame${index}`);
		const document = buildRasterLottie('Test', 320, 240, raster, frames);
		expect(document).toMatchObject({ fr: 12, ip: 0, op: 24, w: 320, h: 240 });
		expect(document.assets).toHaveLength(24);
		expect(document.layers).toHaveLength(24);
		expect((document.layers as Array<Record<string, unknown>>)[4]).toMatchObject({
			refId: 'frame_4',
			ip: 4,
			op: 5
		});
	});

	it('caps raster frame counts', () => {
		expect(() =>
			validateExportSettings({ durationSeconds: 10, frameRate: 30, lottieMode: 'raster' })
		).toThrow('150 frames');
	});
});
