import type { AnimationProject, PathData, ShapeKeyframe, VectorLayer } from '../animation/model';
import { ANIMATION_LIMITS } from '../animation/model';
import { evaluateLayer } from '../animation/interpolation';
import { parseProject } from '../animation/validation';

const MAX_VECTOR_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_EXPORT_LAYERS = 500;
const MAX_JSON_VALUES = 1_000_000;

export function exportSvg(project: AnimationProject, frame: number): string {
	project = validatedProject(project);
	if (!Number.isInteger(frame) || frame < 0 || frame >= project.timeline.frameCount)
		throw new Error('SVG frame must be an integer within the project timeline.');
	const { width, height, background } = project.canvas;
	const bg = color(background);
	const parts = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<title>${xml(project.name)}</title>`,
		`<rect width="${width}" height="${height}" fill="${bg.hex}" fill-opacity="${bg.alpha}"/>`
	];
	for (const layer of orderedLayers(project)) {
		if (!layer.visible) continue;
		const state = evaluateLayer(layer, frame);
		if (!state) continue;
		const { x, y, rotation, scaleX, scaleY } = state.transform;
		const stroke = color(layer.style.stroke);
		const fill = layer.style.fill === null ? null : color(layer.style.fill);
		parts.push(
			`<g data-layer-id="${xml(layer.id)}" transform="translate(${x} ${y}) rotate(${rotation}) scale(${scaleX} ${scaleY})" opacity="${layerOpacity(layer, state)}">`,
			`<title>${xml(layer.name)}</title>`
		);
		for (const path of state.paths) {
			parts.push(
				`<path d="${svgPath(path)}" stroke="${stroke.hex}" stroke-opacity="${stroke.alpha}" stroke-width="${layer.style.strokeWidth}" stroke-linecap="${layer.style.strokeLineCap}" stroke-linejoin="${layer.style.strokeLineJoin}" stroke-miterlimit="4" fill="${fill?.hex ?? 'none'}" fill-opacity="${fill?.alpha ?? 1}" fill-rule="nonzero"/>`
			);
		}
		parts.push('</g>');
	}
	parts.push('</svg>');
	const svg = parts.join('\n');
	assertTextSize(svg, MAX_VECTOR_EXPORT_BYTES, 'SVG');
	return svg;
}

function validatedProject(project: AnimationProject): AnimationProject {
	// Validate descriptors before serialization so accessors and toJSON hooks never execute.
	const validated = parseProject(project);
	boundedJson(validated, ANIMATION_LIMITS.maxProjectBytes, 'Project');
	if (validated.layers.length > MAX_EXPORT_LAYERS)
		throw new Error(`Vector export supports at most ${MAX_EXPORT_LAYERS} layers.`);
	return validated;
}

function orderedLayers(project: AnimationProject): VectorLayer[] {
	return [...project.layers].sort((a, b) => a.zIndex - b.zIndex);
}

function layerOpacity(layer: VectorLayer, state: ShapeKeyframe): number {
	return layer.style.opacity * (state.opacity ?? 1);
}

function svgPath(path: PathData): string {
	return path
		.map((command) => {
			switch (command.type) {
				case 'M':
				case 'L':
					return `${command.type} ${command.x} ${command.y}`;
				case 'C':
					return `C ${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
				case 'Z':
					return 'Z';
				default:
					throw new Error('SVG export encountered an unsupported path command.');
			}
		})
		.join(' ');
}

function xml(value: string): string {
	return [...value]
		.map((character) => {
			const code = character.codePointAt(0)!;
			const valid =
				code === 9 ||
				code === 10 ||
				code === 13 ||
				(code >= 32 && code <= 0xd7ff) ||
				(code >= 0xe000 && code <= 0xfffd) ||
				code >= 0x10000;
			return valid ? character : '\ufffd';
		})
		.join('')
		.replace(
			/[&<>"']/g,
			(character) =>
				({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!
		);
}

/** Never pass arbitrary CSS (notably url(...)) through to an SVG attribute. */
function color(value: string): { hex: string; alpha: number } {
	const paint = value.trim().toLowerCase();
	const named: Record<string, string> = {
		transparent: '#00000000',
		none: '#00000000',
		black: '#000000',
		white: '#ffffff',
		red: '#ff0000',
		green: '#008000',
		blue: '#0000ff',
		yellow: '#ffff00',
		cyan: '#00ffff',
		aqua: '#00ffff',
		magenta: '#ff00ff',
		fuchsia: '#ff00ff',
		gray: '#808080',
		grey: '#808080',
		orange: '#ffa500',
		purple: '#800080',
		pink: '#ffc0cb',
		brown: '#a52a2a',
		navy: '#000080',
		teal: '#008080',
		lime: '#00ff00',
		silver: '#c0c0c0',
		maroon: '#800000',
		olive: '#808000'
	};
	const functional =
		/^(rgb|rgba)\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(paint);
	if (functional && (functional[1] === 'rgba') === (functional[5] !== undefined)) {
		const channels = functional.slice(2, 5).map(Number);
		const alpha = functional[5] === undefined ? 1 : Number(functional[5]);
		if (
			channels.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255) &&
			Number.isFinite(alpha) &&
			alpha >= 0 &&
			alpha <= 1
		)
			return { hex: `rgb(${channels.join(',')})`, alpha };
	}
	let hex = Object.hasOwn(named, paint) ? named[paint] : paint;
	if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.test(hex))
		throw new Error('Vector export requires a safe hex, rgb(), rgba(), or supported named color.');
	if (hex.length === 4 || hex.length === 5)
		hex = '#' + [...hex.slice(1)].map((digit) => digit + digit).join('');
	return {
		hex: hex.slice(0, 7),
		alpha: hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1
	};
}

function assertTextSize(text: string, limit: number, label: string): void {
	if (text.length > limit || new Blob([text]).size > limit)
		throw new Error(`${label} exceeds the ${limit / 1024 / 1024} MiB size limit.`);
}

function boundedJson(value: unknown, limit: number, label: string): void {
	let characters = 0;
	let values = 0;
	try {
		const json = JSON.stringify(value, (key, item: unknown) => {
			characters += key.length + (typeof item === 'string' ? item.length : 1);
			if (characters > limit || ++values > MAX_JSON_VALUES)
				throw new Error(`${label} exceeds the export size or complexity limit.`);
			if (typeof item === 'number' && !Number.isFinite(item))
				throw new Error(`${label} contains a non-finite number.`);
			return item;
		});
		assertTextSize(json, limit, label);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(label)) throw error;
		throw new Error(`${label} must be a finite, JSON-serializable document.`, { cause: error });
	}
}
