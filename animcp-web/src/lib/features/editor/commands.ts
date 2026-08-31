import type { ConfigObject, SketchDefinition } from '$lib/features/config/schema';
import { mergeConfig, parseDefinition, setConfigValue } from '$lib/features/config/schema';
import {
	buildRasterLottie,
	validateExportSettings,
	validateNativeLottie,
	type LottieDocument
} from '$lib/features/export/lottie';
import type { ExportSettings, P5Project } from '$lib/features/projects/project';

export type PlaybackAction = 'play' | 'pause' | 'restart';
export type ConfigPatch = { path: string[]; value: unknown };

export interface SketchRuntimeHandle {
	loadSource(source: string): Promise<SketchDefinition & { supportsNativeLottie?: boolean }>;
	start(config: ConfigObject): Promise<void>;
	applyConfig(config: ConfigObject): void;
	control(action: PlaybackAction): void;
	capture(): Promise<Blob>;
	supportsNativeLottie(): boolean;
	exportNativeLottie(settings: ExportSettings): Promise<unknown>;
	captureLottieFrames(
		settings: ExportSettings,
		onProgress?: (progress: number) => void
	): Promise<{ frames: string[]; width: number; height: number }>;
}

type Dependencies = {
	getProject: () => P5Project;
	setProject: (project: P5Project) => void;
	runtime: () => SketchRuntimeHandle;
};

export function createEditorCommands(deps: Dependencies) {
	let replacingSource = false;
	let exportingLottie = false;

	function commit(changes: Partial<P5Project>) {
		const project = deps.getProject();
		const next = {
			...project,
			...changes,
			revision: project.revision + 1,
			updatedAt: new Date().toISOString()
		};
		deps.setProject(next);
		return next;
	}

	function assertRevision(expected?: number) {
		if (expected !== undefined && expected !== deps.getProject().revision)
			throw new Error(
				`Revision conflict: expected ${expected}, current ${deps.getProject().revision}.`
			);
	}

	return {
		async load() {
			const project = deps.getProject();
			const definition = await deps.runtime().loadSource(project.source);
			const parsed = parseDefinition(definition.config, definition.schema);
			const config = mergeConfig(parsed.schema, parsed.config, project.config);
			await deps.runtime().start(config);
			return config;
		},

		async replaceSource(source: string, expectedRevision?: number) {
			if (exportingLottie) throw new Error('Wait for the Lottie export to finish.');
			if (replacingSource) throw new Error('A source replacement is already in progress.');
			assertRevision(expectedRevision);
			if (!source.trim() || source.length > 200_000)
				throw new Error('Sketch source must contain 1-200,000 characters.');
			const previous = deps.getProject();
			replacingSource = true;
			try {
				const definition = await deps.runtime().loadSource(source);
				const parsed = parseDefinition(definition.config, definition.schema);
				if (deps.getProject().revision !== previous.revision)
					throw new Error(
						`Revision conflict: expected ${previous.revision}, current ${deps.getProject().revision}.`
					);
				const config = mergeConfig(parsed.schema, parsed.config, previous.config);
				await deps.runtime().start(config);
				return commit({ source, config, schema: parsed.schema });
			} catch (error) {
				const current = deps.getProject();
				try {
					await deps.runtime().loadSource(current.source);
					await deps.runtime().start(current.config);
				} catch {}
				throw error;
			} finally {
				replacingSource = false;
			}
		},

		patchConfig(patches: ConfigPatch[], expectedRevision?: number) {
			if (exportingLottie) throw new Error('Wait for the Lottie export to finish.');
			if (replacingSource) throw new Error('Wait for the source replacement to finish.');
			assertRevision(expectedRevision);
			if (!Array.isArray(patches) || patches.length === 0 || patches.length > 50)
				throw new Error('Provide 1-50 config patches.');
			const project = deps.getProject();
			const config = patches.reduce(
				(current, patch) => setConfigValue(current, project.schema, patch.path, patch.value),
				project.config
			);
			const next = commit({ config });
			deps.runtime().applyConfig(config);
			return next;
		},

		updateExportSettings(settings: ExportSettings) {
			if (replacingSource || exportingLottie)
				throw new Error('Wait for the current operation to finish.');
			validateExportSettings(settings);
			const project = deps.getProject();
			const next = {
				...project,
				exportSettings: { ...settings },
				updatedAt: new Date().toISOString()
			};
			deps.setProject(next);
			return next;
		},

		control(action: PlaybackAction) {
			if (exportingLottie) throw new Error('Wait for the Lottie export to finish.');
			deps.runtime().control(action);
			return { action };
		},

		capture() {
			if (exportingLottie) throw new Error('Wait for the Lottie export to finish.');
			return deps.runtime().capture();
		},

		supportsNativeLottie() {
			return deps.runtime().supportsNativeLottie();
		},

		async exportLottie(onProgress?: (progress: number) => void): Promise<LottieDocument> {
			if (exportingLottie || replacingSource)
				throw new Error('Another editor operation is already in progress.');
			exportingLottie = true;
			const project = deps.getProject();
			const settings = { ...project.exportSettings };
			try {
				validateExportSettings(settings);
				if (settings.lottieMode === 'vector') {
					if (!deps.runtime().supportsNativeLottie())
						throw new Error(
							'This sketch does not provide window.exportLottie. Choose Raster Lottie or ask the agent to add a vector exporter.'
						);
					return validateNativeLottie(await deps.runtime().exportNativeLottie(settings), settings);
				}
				const capture = await deps.runtime().captureLottieFrames(settings, onProgress);
				return buildRasterLottie(
					project.name,
					capture.width,
					capture.height,
					settings,
					capture.frames
				);
			} finally {
				exportingLottie = false;
			}
		}
	};
}

export type EditorCommands = ReturnType<typeof createEditorCommands>;
