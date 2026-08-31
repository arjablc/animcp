import type { ConfigObject, SchemaNode } from '$lib/features/config/schema';
import { defaultConfig, defaultSchema, defaultSource } from './starter';

export const exportFrameRates = [12, 15, 24, 30] as const;
export type ExportFrameRate = (typeof exportFrameRates)[number];
export type LottieMode = 'vector' | 'raster';
export type ExportSettings = {
	durationSeconds: number;
	frameRate: ExportFrameRate;
	lottieMode: LottieMode;
};

export const defaultExportSettings: ExportSettings = {
	durationSeconds: 5,
	frameRate: 30,
	lottieMode: 'vector'
};

export type P5Project = {
	version: 2;
	id: string;
	name: string;
	source: string;
	config: ConfigObject;
	schema: SchemaNode;
	exportSettings: ExportSettings;
	revision: number;
	createdAt: string;
	updatedAt: string;
};

export function createProject(name = 'Untitled sketch', now = new Date()): P5Project {
	const timestamp = now.toISOString();
	return {
		version: 2,
		id: crypto.randomUUID(),
		name,
		source: defaultSource,
		config: structuredClone(defaultConfig),
		schema: structuredClone(defaultSchema),
		exportSettings: { ...defaultExportSettings },
		revision: 0,
		createdAt: timestamp,
		updatedAt: timestamp
	};
}
