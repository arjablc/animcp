import {
	defaultExportSettings,
	exportFrameRates,
	type ExportSettings,
	type P5Project
} from './project';
import { defaultSource, legacyDefaultSource } from './starter';

const storageKey = 'animcp.p5-projects.v2';
const legacyStorageKey = 'animcp.p5-projects.v1';

export function getProjects(): P5Project[] {
	try {
		const value = JSON.parse(
			localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey) ?? '[]'
		);
		return Array.isArray(value)
			? value.map(migrateProject).filter((project): project is P5Project => !!project)
			: [];
	} catch {
		return [];
	}
}

export function getProject(id: string) {
	return getProjects().find((project) => project.id === id);
}

export function saveProject(project: P5Project) {
	const projects = getProjects();
	const index = projects.findIndex((item) => item.id === project.id);
	if (index === -1) projects.unshift(project);
	else projects[index] = project;
	localStorage.setItem(storageKey, JSON.stringify(projects));
}

export function deleteProject(id: string) {
	localStorage.setItem(
		storageKey,
		JSON.stringify(getProjects().filter((project) => project.id !== id))
	);
}

export function migrateProject(value: unknown): P5Project | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const project = value as Record<string, unknown>;
	if (
		![1, 2].includes(project.version as number) ||
		typeof project.id !== 'string' ||
		typeof project.name !== 'string' ||
		typeof project.source !== 'string' ||
		typeof project.revision !== 'number' ||
		!project.config ||
		!project.schema
	)
		return undefined;
	const upgradeStarter = project.source === legacyDefaultSource;
	return {
		...project,
		version: 2,
		source: upgradeStarter ? defaultSource : project.source,
		revision: project.revision + (upgradeStarter ? 1 : 0),
		exportSettings: normalizeExportSettings(project.exportSettings)
	} as P5Project;
}

function normalizeExportSettings(value: unknown): ExportSettings {
	if (!value || typeof value !== 'object') return { ...defaultExportSettings };
	const settings = value as Partial<ExportSettings>;
	return {
		durationSeconds:
			typeof settings.durationSeconds === 'number' &&
			settings.durationSeconds >= 1 &&
			settings.durationSeconds <= 10
				? settings.durationSeconds
				: defaultExportSettings.durationSeconds,
		frameRate: exportFrameRates.includes(settings.frameRate as ExportSettings['frameRate'])
			? (settings.frameRate as ExportSettings['frameRate'])
			: defaultExportSettings.frameRate,
		lottieMode:
			settings.lottieMode === 'raster' || settings.lottieMode === 'vector'
				? settings.lottieMode
				: defaultExportSettings.lottieMode
	};
}
