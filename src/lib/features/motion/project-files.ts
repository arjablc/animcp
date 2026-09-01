import { check } from './model';
import type { MotionSession } from './session.svelte';
import { importArtwork } from './assets';
import { download, exportSvg } from './render';
import { loadProjectFonts } from './fonts';
import { exportLottie } from './lottie';

export type ExportFormat = 'native' | 'svg' | 'lottie';

/** Importing is asynchronous, so commit against the revision seen before reading the files. */
export async function importArtworkFiles(session: MotionSession, files: FileList) {
	const revision = session.project.revision;
	const assets = await Promise.all([...files].map(importArtwork));
	const result = session.commit(
		assets.map((asset) => ({ name: 'import_asset', input: { asset } })),
		'Imported artwork',
		'human',
		revision
	);
	session.select(result.data.map((item) => (item as { layerId: string }).layerId));
}

export async function exportProject(session: MotionSession, format: ExportFormat) {
	// Clone the reactive state before awaiting font loading so the export stays consistent.
	const project = structuredClone(session.project);
	const name = project.name.replace(/[^a-z0-9_-]/gi, '_');

	if (format === 'native') {
		const text = JSON.stringify(project, null, 2);
		check(new Blob([text]).size <= 50 * 1024 * 1024, 'Project exceeds 50 MiB export limit');
		download(text, `${name}.animcp.json`);
		return;
	}

	await loadProjectFonts(project.layers);
	if (format === 'lottie') {
		download(JSON.stringify(await exportLottie(project)), `${name}.lottie.json`);
		return;
	}

	download(exportSvg(project, session.context.currentFrame), `${name}.svg`, 'image/svg+xml');
	if (
		project.layers.some(
			(layer) =>
				layer.type === 'text' && !['sans-serif', 'serif', 'monospace'].includes(layer.fontFamily)
		)
	)
		session.error = 'SVG exported with live text. Other devices need the referenced Google Fonts.';
}
