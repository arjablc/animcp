import { check, type Layer } from './model';
export type FontFamily = { family: string; weights: number[]; italic: boolean };
const pending = new Map<string, Promise<void>>();
export async function catalog(): Promise<FontFamily[]> {
	const r = await fetch('/api/fonts');
	if (!r.ok)
		throw new Error('Font catalog unavailable. You can still enter any Google Fonts family name.');
	return r.json();
}
export async function loadFont(
	family: string,
	weight = 400,
	style = 'normal',
	text = 'Hello'
): Promise<void> {
	if (['sans-serif', 'serif', 'monospace', 'system-ui'].includes(family)) return;
	check(
		// eslint-disable-next-line no-control-regex -- reject ASCII control characters in user input
		family.length > 0 && family.length <= 200 && !/[\u0000-\u001f]/.test(family),
		'Invalid font family'
	);
	const key = JSON.stringify([family, weight, style]);
	let loading = pending.get(key);
	if (!loading) {
		loading = new Promise<void>((resolve, reject) => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@${style === 'italic' ? 1 : 0},${weight}&display=swap`;
			const timer = setTimeout(() => {
				link.remove();
				reject(new Error(`Font ${family} timed out. Check your connection.`));
			}, 15000);
			link.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			link.onerror = () => {
				clearTimeout(timer);
				link.remove();
				reject(
					new Error(
						`Google Fonts could not load ${family} ${weight} ${style}. Check this style and your connection.`
					)
				);
			};
			document.head.appendChild(link);
		}).catch((error) => {
			pending.delete(key);
			throw error;
		});
		pending.set(key, loading);
	}
	await loading;
	const faces = await document.fonts.load(
		`${style} ${weight} 32px ${JSON.stringify(family)}`,
		text
	);
	check(faces.length > 0, `Font ${family} is unavailable; choose another style or retry online`);
}
export async function loadProjectFonts(layers: Layer[]) {
	await Promise.all(
		layers
			.filter((l) => l.type === 'text')
			.map((l) => loadFont(l.fontFamily, l.fontWeight, l.fontStyle, l.text))
	);
}
