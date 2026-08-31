<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import p5Source from 'virtual:p5-runtime';
	import type { ConfigObject, SketchDefinition } from '$lib/features/config/schema';
	import type { PlaybackAction } from '$lib/features/editor/commands';
	import type { ExportSettings } from '$lib/features/projects/project';
	import { runtimeDocument } from './runtime-document';

	type Deferred<T> = {
		promise: Promise<T>;
		resolve: (value: T) => void;
		reject: (error: Error) => void;
	};

	let { onstatus = (_status: string) => {}, onerror = (_message: string) => {} } = $props<{
		onstatus?: (status: string) => void;
		onerror?: (message: string) => void;
	}>();

	let frame: HTMLIFrameElement;
	let generation = $state(0);
	let instanceId = '';
	let currentSource = '';
	let currentConfig: ConfigObject = {};
	let ready: Deferred<void> | undefined;
	let definition: Deferred<SketchDefinition> | undefined;
	let started: Deferred<void> | undefined;
	let nativeLottieSupported = false;
	let playback: 'running' | 'paused' = 'running';
	let startingPaused = false;
	const requests = new Map<string, Deferred<unknown>>();
	const progressCallbacks = new Map<string, (progress: number) => void>();
	// Replacing `srcdoc` creates a clean sandbox whenever the generation changes.
	let srcdoc = $derived(runtimeDocument(p5Source, generation));

	function handleMessage(event: MessageEvent) {
		if (event.source !== frame?.contentWindow || !event.data || typeof event.data !== 'object')
			return;
		const message = event.data as Record<string, unknown>;
		if (message.type === 'runtime-ready' && message.generation === generation) {
			ready?.resolve();
			return;
		}
		if (message.instanceId !== instanceId) return;
		if (message.type === 'definition-loaded') {
			nativeLottieSupported = message.supportsNativeLottie === true;
			definition?.resolve({
				config: message.config as ConfigObject,
				schema: message.schema as SketchDefinition['schema']
			});
		} else if (message.type === 'sketch-started') {
			// ponytail: Chromium can leave an isolated srcdoc frame unpainted until its host is laid out again.
			frame.style.display = 'none';
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					frame.style.display = '';
					requestAnimationFrame(() => {
						if (message.instanceId !== instanceId) return;
						onstatus(startingPaused ? 'paused' : 'running');
						started?.resolve();
					});
				});
			});
		} else if (message.type === 'runtime-error') {
			const text = typeof message.message === 'string' ? message.message : 'The sketch failed.';
			onstatus('error');
			onerror(text);
			definition?.reject(new Error(text));
			started?.reject(new Error(text));
			rejectRequests(new Error(text));
		} else if (message.type === 'canvas-captured') {
			resolveRequest(
				message.requestId,
				message.blob instanceof Blob
					? message.blob
					: new Error('The runtime returned an invalid canvas image.')
			);
		} else if (message.type === 'native-lottie-exported') {
			resolveRequest(message.requestId, message.document);
		} else if (message.type === 'raster-lottie-exported') {
			resolveRequest(message.requestId, {
				frames: message.frames,
				width: message.width,
				height: message.height
			});
		} else if (message.type === 'lottie-export-progress' && typeof message.progress === 'number') {
			progressCallbacks.get(message.requestId as string)?.(message.progress);
		} else if (message.type === 'export-failed') {
			resolveRequest(
				message.requestId,
				new Error(typeof message.message === 'string' ? message.message : 'Lottie export failed.')
			);
		}
	}

	$effect(() => {
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	});

	onDestroy(() => rejectPending(new Error('Sketch runtime closed.')));

	export async function loadSource(source: string): Promise<SketchDefinition> {
		rejectPending(new Error('Sketch runtime replaced.'));
		currentSource = source;
		instanceId = crypto.randomUUID();
		ready = deferred<void>();
		definition = deferred<SketchDefinition>();
		onstatus('loading');
		generation += 1;
		await tick();
		await withTimeout(ready.promise, 5_000, 'Sketch sandbox did not start.');
		frame.contentWindow?.postMessage({ type: 'load-source', instanceId, source }, '*');
		return withTimeout(definition.promise, 5_000, 'Sketch definition did not load.');
	}

	export async function start(config: ConfigObject, paused = false) {
		currentConfig = structuredClone(config);
		startingPaused = paused;
		started = deferred<void>();
		frame.contentWindow?.postMessage({ type: 'start-sketch', instanceId, config, paused }, '*');
		await withTimeout(started.promise, 5_000, 'Sketch setup did not finish.');
		playback = paused ? 'paused' : 'running';
	}

	export function applyConfig(config: ConfigObject) {
		currentConfig = structuredClone(config);
		frame.contentWindow?.postMessage({ type: 'apply-config', instanceId, config }, '*');
	}

	export function control(action: PlaybackAction) {
		if (action === 'restart') {
			void loadSource(currentSource)
				.then(() => start(currentConfig))
				.catch((error) => onerror(message(error)));
			return;
		}
		frame.contentWindow?.postMessage({ type: 'control', instanceId, action }, '*');
		playback = action === 'play' ? 'running' : 'paused';
		onstatus(action === 'play' ? 'running' : 'paused');
	}

	export async function capture() {
		return request<Blob>('capture-canvas', {}, 5_000, 'Canvas export timed out.');
	}

	export function supportsNativeLottie() {
		return nativeLottieSupported;
	}

	export function exportNativeLottie(settings: ExportSettings) {
		return request<unknown>(
			'export-native-lottie',
			{ settings },
			10_000,
			'Vector Lottie export timed out.'
		);
	}

	export async function captureLottieFrames(
		settings: ExportSettings,
		onProgress?: (progress: number) => void
	) {
		const previousPlayback = playback;
		await loadSource(currentSource);
		await start(currentConfig, true);
		try {
			return await request<{ frames: string[]; width: number; height: number }>(
				'capture-lottie-frames',
				{ settings },
				60_000,
				'Raster Lottie export timed out.',
				onProgress
			);
		} finally {
			await loadSource(currentSource);
			await start(currentConfig, previousPlayback === 'paused');
		}
	}

	function rejectPending(error: Error) {
		ready?.reject(error);
		definition?.reject(error);
		started?.reject(error);
		rejectRequests(error);
		ready = undefined;
		definition = undefined;
		started = undefined;
	}

	async function request<T>(
		type: string,
		payload: Record<string, unknown>,
		timeout: number,
		timeoutMessage: string,
		onProgress?: (progress: number) => void
	) {
		const requestId = crypto.randomUUID();
		const pending = deferred<unknown>();
		requests.set(requestId, pending);
		if (onProgress) progressCallbacks.set(requestId, onProgress);
		frame.contentWindow?.postMessage({ type, instanceId, requestId, ...payload }, '*');
		try {
			return (await withTimeout(pending.promise, timeout, timeoutMessage)) as T;
		} finally {
			requests.delete(requestId);
			progressCallbacks.delete(requestId);
		}
	}

	function resolveRequest(requestId: unknown, value: unknown) {
		if (typeof requestId !== 'string') return;
		const pending = requests.get(requestId);
		if (!pending) return;
		if (value instanceof Error) pending.reject(value);
		else pending.resolve(value);
	}

	function rejectRequests(error: Error) {
		for (const pending of requests.values()) pending.reject(error);
		requests.clear();
		progressCallbacks.clear();
	}

	function message(error: unknown) {
		return error instanceof Error ? error.message : 'The sketch failed.';
	}

	function deferred<T>(): Deferred<T> {
		let resolve!: (value: T) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<T>((accept, decline) => {
			resolve = accept;
			reject = decline;
		});
		// A rejected request can be replaced before its original caller awaits it.
		promise.catch(() => {});
		return { promise, resolve, reject };
	}

	function withTimeout<T>(promise: Promise<T>, timeout: number, timeoutMessage: string) {
		return new Promise<T>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeout);
			promise.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				}
			);
		});
	}
</script>

<iframe bind:this={frame} title="p5.js sketch preview" sandbox="allow-scripts" {srcdoc}></iframe>

<style>
	iframe {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 260px;
		border: 0;
		background: #0a0b09;
	}
</style>
