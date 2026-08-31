import { describe, expect, it, vi } from 'vitest';
import {
	createEditorCommands,
	type SketchRuntimeHandle
} from '../src/lib/features/editor/commands';
import type { P5Project } from '../src/lib/features/projects/project';

const schema = {
	type: 'object' as const,
	properties: {
		orb: { type: 'object' as const, properties: { size: { type: 'number' as const } } }
	}
};

function setup() {
	let project: P5Project = {
		version: 2,
		id: 'project',
		name: 'Test',
		source: 'old',
		config: { orb: { size: 9 } },
		schema,
		exportSettings: { durationSeconds: 5, frameRate: 30, lottieMode: 'vector' },
		revision: 3,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	};
	const runtime: SketchRuntimeHandle = {
		loadSource: vi.fn(async () => ({ config: { orb: { size: 2 } }, schema })),
		start: vi.fn(async () => {}),
		applyConfig: vi.fn(),
		control: vi.fn(),
		capture: vi.fn(async () => new Blob()),
		supportsNativeLottie: vi.fn(() => true),
		exportNativeLottie: vi.fn(async () => ({
			v: '5.12.2',
			fr: 30,
			ip: 0,
			op: 150,
			w: 100,
			h: 100,
			assets: [],
			layers: []
		})),
		captureLottieFrames: vi.fn(async () => ({ frames: [], width: 100, height: 100 }))
	};
	const commands = createEditorCommands({
		getProject: () => project,
		setProject: (next) => {
			project = next;
		},
		runtime: () => runtime
	});
	return { commands, runtime, project: () => project };
}

describe('editor commands', () => {
	it('preserves human config when replacing source', async () => {
		const test = setup();
		const project = await test.commands.replaceSource('new', 3);
		expect(project.source).toBe('new');
		expect(project.config).toEqual({ orb: { size: 9 } });
		expect(project.revision).toBe(4);
		expect(test.runtime.start).toHaveBeenCalledWith({ orb: { size: 9 } });
	});

	it('rejects stale agent revisions', async () => {
		const test = setup();
		await expect(test.commands.replaceSource('new', 2)).rejects.toThrow('Revision conflict');
		expect(test.runtime.loadSource).not.toHaveBeenCalled();
	});

	it('routes config updates into the runtime', () => {
		const test = setup();
		const project = test.commands.patchConfig([{ path: ['orb', 'size'], value: 12 }], 3);
		expect(project.config).toEqual({ orb: { size: 12 } });
		expect(test.runtime.applyConfig).toHaveBeenCalledWith({ orb: { size: 12 } });
	});

	it('does not accept config edits during source validation', async () => {
		const test = setup();
		let finish!: (value: { config: { orb: { size: number } }; schema: typeof schema }) => void;
		vi.mocked(test.runtime.loadSource).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const replacement = test.commands.replaceSource('new', 3);
		expect(() => test.commands.patchConfig([{ path: ['orb', 'size'], value: 12 }], 3)).toThrow(
			'source replacement'
		);
		finish({ config: { orb: { size: 2 } }, schema });
		await expect(replacement).resolves.toMatchObject({ revision: 4 });
	});

	it('validates and delegates native Lottie export', async () => {
		const test = setup();
		const document = await test.commands.exportLottie();
		expect(document).toMatchObject({ fr: 30, op: 150, w: 100, h: 100 });
		expect(test.runtime.exportNativeLottie).toHaveBeenCalledWith(test.project().exportSettings);
	});

	it('persists export settings without changing the sketch revision', () => {
		const test = setup();
		const project = test.commands.updateExportSettings({
			durationSeconds: 4,
			frameRate: 24,
			lottieMode: 'raster'
		});
		expect(project.exportSettings).toEqual({
			durationSeconds: 4,
			frameRate: 24,
			lottieMode: 'raster'
		});
		expect(project.revision).toBe(3);
	});
});
