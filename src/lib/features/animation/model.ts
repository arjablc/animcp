import { assertJsonSafe, parseProject, validateObject } from './validation';

export type LayerId = string;
export type FrameRate = 12 | 15 | 24 | 30;
export type CanvasSettings = { width: number; height: number; background: string };
export type TimelineSettings = { fps: FrameRate; frameCount: number };
export type PathCommand =
	| { type: 'M'; x: number; y: number }
	| { type: 'L'; x: number; y: number }
	| { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
	| { type: 'Z' };
export type PathData = PathCommand[];
export type Transform = {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
};
export type Easing =
	| { type: 'linear' }
	| { type: 'hold' }
	| { type: 'bezier'; x1: number; y1: number; x2: number; y2: number };
export type LayerStyle = {
	stroke: string;
	strokeWidth: number;
	strokeLineCap: 'butt' | 'round' | 'square';
	strokeLineJoin: 'miter' | 'round' | 'bevel';
	fill: string | null;
	opacity: number;
};
export type ShapeKeyframe = {
	paths: PathData[];
	transform: Transform;
	easing: Easing;
	/** Animated multiplier; effective opacity is style.opacity * (opacity ?? 1). */
	opacity?: number;
	generated?: boolean;
};
export type VectorLayer = {
	id: LayerId;
	name: string;
	visible: boolean;
	locked: boolean;
	zIndex: number;
	style: LayerStyle;
	keyframes: Record<number, ShapeKeyframe>;
};
export type AssetRecord = {
	id: string;
	name: string;
	kind: 'raster' | 'vector';
	mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
	width: number;
	height: number;
	byteLength: number;
	source: 'file' | 'webmcp' | 'vectorized';
	blobKey: string;
	createdAt: string;
};
export type AnimationProject = {
	version: 1;
	kind: 'vector-animation';
	id: string;
	name: string;
	canvas: CanvasSettings;
	timeline: TimelineSettings;
	layers: VectorLayer[];
	assets: AssetRecord[];
	revision: number;
	createdAt: string;
	updatedAt: string;
};

export const ANIMATION_LIMITS = Object.freeze({
	maxLayers: 200,
	maxAssets: 200,
	maxPathCommands: 10_000,
	maxTotalPathCommands: 200_000,
	maxFrames: 1_800,
	maxAssetBytes: 10 * 1024 * 1024,
	maxProjectBytes: 20 * 1024 * 1024,
	maxNameLength: 200,
	maxCoordinate: 1_000_000,
	minScale: 0.01,
	maxScale: 100,
	maxEasingY: 10,
	maxHistoryEntries: 100
});

/** Factories deliberately return fresh objects, never shared mutable defaults. */
export function defaultStyle(): LayerStyle {
	return {
		stroke: '#00c3ff',
		strokeWidth: 4,
		strokeLineCap: 'round',
		strokeLineJoin: 'round',
		fill: null,
		opacity: 1
	};
}

export function identityTransform(): Transform {
	return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}

export type CreateAnimationProjectOptions = {
	id?: string;
	name?: string;
	canvas?: Partial<CanvasSettings>;
	timeline?: Partial<TimelineSettings>;
};

export function createAnimationProject(
	options: string | CreateAnimationProjectOptions = {}
): AnimationProject {
	const settings = typeof options === 'string' ? { name: options } : options;
	assertJsonSafe(settings);
	validateObject(settings, ['id', 'name', 'canvas', 'timeline'], 'options');
	if (settings.canvas !== undefined)
		validateObject(settings.canvas, ['width', 'height', 'background'], 'canvas');
	if (settings.timeline !== undefined)
		validateObject(settings.timeline, ['fps', 'frameCount'], 'timeline');
	const now = new Date().toISOString();
	const fps = settings.timeline?.fps ?? 30;
	return parseProject({
		version: 1,
		kind: 'vector-animation',
		id: settings.id === undefined ? `project_${globalThis.crypto.randomUUID()}` : settings.id,
		name: settings.name === undefined ? 'Untitled animation' : settings.name,
		canvas: { width: 960, height: 540, background: '#111827', ...settings.canvas },
		timeline: { fps, frameCount: fps * 5, ...settings.timeline },
		layers: [],
		assets: [],
		revision: 0,
		createdAt: now,
		updatedAt: now
	});
}

/** Back-to-front order; no locale-dependent comparisons or input mutations. */
export function orderedLayers(layers: readonly VectorLayer[]): VectorLayer[] {
	return [...layers].sort((a, b) => a.zIndex - b.zIndex);
}
