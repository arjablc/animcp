import { check } from './model';
import type { MotionSession } from './session.svelte';
import { importArtwork } from './assets';
import { download, exportSvg } from './render';
import { loadProjectFonts } from './fonts';
import { exportLottie } from './lottie';

export type ExportFormat = 'native' | 'svg' | 'lottie' | 'mp4';

const mp4MimeTypes = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];

function mp4MimeType() {
	if (typeof MediaRecorder === 'undefined') return;
	return mp4MimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
}

function pause(milliseconds: number) {
	return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function drawSvgFrame(canvas: HTMLCanvasElement, svg: string) {
	const image = new Image(),
		url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Could not render an MP4 frame.'));
			image.src = url;
		});
		const context = canvas.getContext('2d', { alpha: false });
		check(context, 'Canvas rendering is unavailable in this browser');
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function exportMp4(
	project: Parameters<typeof exportSvg>[0],
	onProgress?: (progress: number) => void
) {
	const mimeType = mp4MimeType();
	check(
		mimeType,
		'MP4 export needs a browser with H.264 recording support. Try the latest Chrome, Edge, or Safari.'
	);
	check(typeof HTMLCanvasElement !== 'undefined', 'Canvas export is unavailable in this browser');
	const canvas = document.createElement('canvas');
	canvas.width = project.composition.width;
	canvas.height = project.composition.height;
	check(
		typeof canvas.captureStream === 'function',
		'MP4 export needs canvas video capture support.'
	);

	const stream = canvas.captureStream(project.composition.fps);
	const chunks: BlobPart[] = [];
	const recorder = new MediaRecorder(stream, { mimeType });
	const stopped = new Promise<void>((resolve, reject) => {
		recorder.addEventListener('stop', () => resolve(), { once: true });
		recorder.addEventListener('error', () => reject(new Error('MP4 recording failed.')), {
			once: true
		});
	});
	recorder.addEventListener('dataavailable', (event) => {
		if (event.data.size) chunks.push(event.data);
	});
	const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
	const interval = 1000 / project.composition.fps;

	try {
		await drawSvgFrame(canvas, exportSvg(project, 0));
		recorder.start();
		for (let frame = 0; frame < project.composition.durationFrames; frame += 1) {
			if (frame) await drawSvgFrame(canvas, exportSvg(project, frame));
			track.requestFrame?.();
			onProgress?.((frame + 1) / project.composition.durationFrames);
			if (frame < project.composition.durationFrames - 1) await pause(interval);
		}
		recorder.stop();
		await stopped;
	} finally {
		if (recorder.state !== 'inactive') recorder.stop();
		stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
	}
	check(chunks.length, 'MP4 recording produced no video frames.');
	return new Blob(chunks, { type: mimeType });
}

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

export async function exportProject(
	session: MotionSession,
	format: ExportFormat,
	onProgress?: (progress: number) => void
) {
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
	if (format === 'mp4') {
		download(await exportMp4(project, onProgress), `${name}.mp4`, 'video/mp4');
		return;
	}
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
