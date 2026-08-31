import { describe, expect, it } from 'vitest';
import { runtimeDocument } from '../src/lib/features/runtime/runtime-document';

describe('sketch runtime document', () => {
	it('loads p5 and p5.brush before evaluating sketches', () => {
		const document = runtimeDocument('window.p5Loaded = true;', 'window.brushLoaded = true;', 1);
		expect(document.indexOf('window.p5Loaded')).toBeLessThan(document.indexOf('load-source'));
		expect(document).toContain('if (/\\bbrush\\s*[.([]/.test(message.source)) installBrush()');
		expect(document.indexOf('installBrush();')).toBeLessThan(
			document.indexOf('(0, eval)(message.source')
		);
		expect(document).toContain('window.brush.instance(this)');
		expect(document).toContain('brushLoad()');
	});

	it('does not execute p5.brush as an unconditional script', () => {
		const document = runtimeDocument('', 'window.brushLoaded = true;', 1);
		expect(document).not.toContain('<script>window.brushLoaded = true;</script>');
		expect(document).toContain('const brushLibrary = "window.brushLoaded = true;"');
	});
});
