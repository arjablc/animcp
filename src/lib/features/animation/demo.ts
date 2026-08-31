import {
	createAnimationProject,
	defaultStyle,
	identityTransform,
	type AnimationProject,
	type PathData
} from './model';

/** A small, fully editable example with stable path topology at both endpoints. */
export function createDemoProject(): AnimationProject {
	const project = createAnimationProject({
		name: 'The first stroke',
		timeline: { fps: 30, frameCount: 90 },
		canvas: { background: '#172028' }
	});
	const start: PathData = [
		{ type: 'M', x: 205, y: 300 },
		{ type: 'C', x1: 285, y1: 275, x2: 310, y2: 255, x: 370, y: 275 },
		{ type: 'C', x1: 430, y1: 300, x2: 490, y2: 300, x: 510, y: 280 }
	];
	const end: PathData = [
		{ type: 'M', x: 180, y: 320 },
		{ type: 'C', x1: 350, y1: 350, x2: 380, y2: 145, x: 490, y: 200 },
		{ type: 'C', x1: 590, y1: 250, x2: 595, y2: 370, x: 770, y: 230 }
	];
	project.layers = [
		{
			id: `layer_${crypto.randomUUID()}`,
			name: 'A confident line',
			visible: true,
			locked: false,
			zIndex: 0,
			style: { ...defaultStyle(), stroke: '#dfff4f', strokeWidth: 9 },
			keyframes: {
				0: {
					paths: [start],
					transform: identityTransform(),
					easing: { type: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
				},
				60: { paths: [end], transform: identityTransform(), easing: { type: 'linear' } }
			}
		}
	];
	return project;
}
