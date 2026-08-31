import {
	createLayer,
	createProject,
	demoProject,
	presets,
	setGradient,
	uid,
	type Layer
} from './model';
export const templates = [
	{
		id: 'cards',
		name: 'Product cards',
		description: 'Turn three robotic entrances into a coordinated sequence.'
	},
	{ id: 'logo', name: 'Logo reveal', description: 'Shape a simple mark and reveal its name.' },
	{
		id: 'lower-third',
		name: 'Lower third',
		description: 'Give a name and role a more deliberate entrance.'
	},
	{
		id: 'title',
		name: 'Kinetic title',
		description: 'Play with the rhythm between individual words.'
	},
	{
		id: 'onboarding',
		name: 'App onboarding',
		description: 'Coordinate a heading, panel, and call to action.'
	}
];
export function fromTemplate(id: string) {
	if (id === 'cards') return demoProject();
	const template = templates.find((t) => t.id === id);
	if (!template) throw new Error('Unknown template');
	const p = createProject(template.name);
	const animate = (l: Layer, prop: string, start: number, end: number) => {
		l.tracks[prop].keys = [
			{ id: uid(), frame: 6, value: start, easing: presets.linear },
			{ id: uid(), frame: 36, value: end, easing: presets.linear }
		];
	};
	const text = (content: string, x: number, y: number, size: number, color = '#f4f7fb') => {
		const l = createLayer('text', content);
		l.text = content;
		l.fontSize = size;
		l.tracks.positionX.defaultValue = x;
		l.tracks.positionY.defaultValue = y;
		l.tracks.width.defaultValue = 700;
		l.tracks.height.defaultValue = size * 1.5;
		l.tracks.fill.defaultValue = color;
		p.layers.push(l);
		return l;
	};
	const rect = (name: string, x: number, y: number, w: number, h: number) => {
		const l = createLayer('rectangle', name);
		l.tracks.positionX.defaultValue = x;
		l.tracks.positionY.defaultValue = y;
		l.tracks.width.defaultValue = w;
		l.tracks.height.defaultValue = h;
		setGradient(l, 'linear');
		p.layers.push(l);
		return l;
	};
	if (id === 'logo') {
		const mark = createLayer('ellipse', 'Logo mark');
		mark.tracks.positionX.defaultValue = 390;
		mark.tracks.positionY.defaultValue = 90;
		mark.tracks.width.defaultValue = 180;
		mark.tracks.height.defaultValue = 180;
		setGradient(mark, 'radial');
		animate(mark, 'scaleX', 0.2, 1);
		animate(mark, 'scaleY', 0.2, 1);
		p.layers.push(mark);
		const title = text('AniMCP', 345, 310, 64);
		animate(title, 'opacity', 0, 1);
	}
	if (id === 'lower-third') {
		const bar = rect('Name plate', 70, 330, 620, 150);
		animate(bar, 'positionX', -650, 70);
		const name = text('Alex Morgan', 95, 340, 42, '#142334'),
			role = text('Motion designer', 98, 405, 24, '#24384a');
		animate(name, 'opacity', 0, 1);
		animate(role, 'opacity', 0, 1);
	}
	if (id === 'title') {
		for (const [i, word] of ['Make.', 'Move.', 'Matter.'].entries()) {
			const l = text(word, 90, 70 + i * 125, 78, i === 1 ? '#dfff4f' : '#f4f7fb');
			animate(l, 'positionX', -400, 90);
		}
	}
	if (id === 'onboarding') {
		const panel = rect('Welcome panel', 90, 160, 780, 285);
		animate(panel, 'scaleY', 0.4, 1);
		const heading = text('Your next chapter.', 90, 65, 50);
		animate(heading, 'opacity', 0, 1);
		const body = text('Small steps. Meaningful motion.', 130, 205, 34, '#17333d');
		animate(body, 'opacity', 0, 1);
		const cta = text('Get started →', 130, 340, 28, '#17333d');
		animate(cta, 'positionX', -300, 130);
	}
	return p;
}
