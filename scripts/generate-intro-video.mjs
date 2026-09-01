import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const width = 1280;
const height = 720;
const fps = 30;
const frames = 300;
const frameDirectory = '/tmp/animcp-intro-frames';
const output = 'static/animcp-intro.mp4';

mkdirSync(frameDirectory, { recursive: true });
rmSync(frameDirectory, { recursive: true, force: true });
mkdirSync(frameDirectory, { recursive: true });

const clamp = (value) => Math.max(0, Math.min(1, value));
const easeOut = (value) => 1 - Math.pow(1 - clamp(value), 3);
const fade = (frame, start, duration) => easeOut((frame - start) / duration);
const esc = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function text(value, x, y, size, options = {}) {
	const { fill = '#eef4fb', weight = 700, anchor = 'start', opacity = 1, letterSpacing = 0 } = options;
	return `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" letter-spacing="${letterSpacing}" opacity="${opacity}">${esc(value)}</text>`;
}

for (let frame = 0; frame < frames; frame += 1) {
	const phase = frame / fps;
	const intro = fade(frame, 0, 24);
	const design = fade(frame, 38, 20);
	const animate = fade(frame, 90, 20);
	const ship = fade(frame, 142, 20);
	const finale = fade(frame, 205, 20);
	const exit = frame < 270 ? 1 : 1 - easeOut((frame - 270) / 30);
	const cursorX = 360 + easeOut((frame - 180) / 30) * 565;
	const timelinePulse = 0.35 + 0.65 * Math.sin(Math.max(0, phase - 6) * 4) ** 2;
	const cards = [
		{ label: 'DESIGN', color: '#65dff8', alpha: design, x: 140, y: 282 - (1 - design) * 55 },
		{ label: 'ANIMATE', color: '#ff846d', alpha: animate, x: 430, y: 282 - (1 - animate) * 55 },
		{ label: 'SHIP', color: '#f3bd68', alpha: ship, x: 760, y: 282 - (1 - ship) * 55 }
	];
	const cardMarkup = cards.map(({ label, color, alpha, x, y }) => `
		<g opacity="${alpha * exit}" transform="translate(${x} ${y})">
			<rect width="245" height="168" rx="12" fill="#142238" stroke="${color}" stroke-width="2"/>
			<rect x="19" y="20" width="61" height="10" rx="5" fill="${color}" opacity=".85"/>
			<rect x="19" y="51" width="197" height="7" rx="3.5" fill="#496989"/>
			<rect x="19" y="70" width="156" height="7" rx="3.5" fill="#31445a"/>
			${text(label, 19, 137, 25, { fill: '#eef4fb', weight: 800, letterSpacing: 1.5 })}
			<circle cx="213" cy="129" r="11" fill="${color}"/>
		</g>`).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
		<rect width="1280" height="720" fill="#0b1220"/>
		<circle cx="1040" cy="120" r="340" fill="#1b2d46" opacity=".42"/>
		<circle cx="155" cy="660" r="370" fill="#142238" opacity=".7"/>
		<g opacity="${intro * exit}">
			${text('aniMCP', 70, 86, 31, { fill: '#65dff8', weight: 800, letterSpacing: 1.2 })}
			${text('MOTION STUDIO', 210, 86, 14, { fill: '#a7b8cd', weight: 700, letterSpacing: 2.4 })}
			<line x1="70" y1="113" x2="1210" y2="113" stroke="#31445a"/>
			${text('MAKE YOUR NEXT', 70, 206, 63, { fill: '#eef4fb', weight: 800, letterSpacing: -2.2 })}
			${text('MOVE.', 70, 274, 63, { fill: '#65dff8', weight: 800, letterSpacing: -2.2 })}
			${text('A timeline you and your agent can work on together.', 73, 322, 21, { fill: '#a7b8cd', weight: 400 })}
		</g>
		${cardMarkup}
		<g opacity="${Math.max(design, animate, ship) * exit}">
			<rect x="140" y="496" width="1000" height="102" rx="10" fill="#162337" stroke="#31445a"/>
			${text('TIMELINE', 164, 528, 14, { fill: '#a7b8cd', letterSpacing: 2, weight: 700 })}
			<line x1="275" y1="520" x2="1102" y2="520" stroke="#496989" stroke-width="1"/>
			<line x1="275" y1="555" x2="1102" y2="555" stroke="#31445a" stroke-width="1"/>
			<line x1="275" y1="580" x2="1102" y2="580" stroke="#31445a" stroke-width="1"/>
			<rect x="${297}" y="537" width="${160 * design}" height="12" rx="6" fill="#65dff8"/>
			<rect x="${475}" y="562" width="${160 * animate}" height="12" rx="6" fill="#ff846d"/>
			<rect x="${675}" y="587" width="${160 * ship}" height="12" rx="6" fill="#f3bd68"/>
			<line x1="${cursorX}" y1="507" x2="${cursorX}" y2="608" stroke="#eef4fb" stroke-width="2" opacity="${timelinePulse}"/>
		</g>
		<g opacity="${finale * exit}" transform="translate(0 ${20 * (1 - finale)})">
			<rect x="70" y="634" width="1140" height="1" fill="#496989"/>
			${text('Design the composition. Shape the rhythm. Keep control.', 640, 677, 29, { fill: '#eef4fb', weight: 700, anchor: 'middle' })}
		</g>
	</svg>`;
	writeFileSync(`${frameDirectory}/frame-${String(frame).padStart(4, '0')}.svg`, svg);
}

execFileSync('ffmpeg', [
	'-y', '-framerate', String(fps), '-i', `${frameDirectory}/frame-%04d.svg`,
	'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', output
], { stdio: 'inherit' });

rmSync(frameDirectory, { recursive: true, force: true });
console.log(`Created ${output}`);
