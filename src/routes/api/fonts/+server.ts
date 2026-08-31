import { json } from '@sveltejs/kit';
// Public catalog metadata only. Font binaries are requested directly from Google on demand.
// Google's Developer API needs an API key; the public catalog does not. Isolate its format here.
export async function GET({ fetch }) {
	try {
		const response = await fetch('https://fonts.google.com/metadata/fonts', {
			signal: AbortSignal.timeout(10000)
		});
		if (!response.ok) throw new Error('Catalog fetch failed');
		const data = JSON.parse((await response.text()).replace(/^\)\]\}'\s*/, ''));
		if (!Array.isArray(data.familyMetadataList)) throw new Error('Unknown catalog format');
		const families = data.familyMetadataList
			.map(
				(font: {
					family: string;
					fonts?: Record<string, unknown>;
					axes?: { tag: string; min: number; max: number }[];
				}) => {
					const styles = Object.keys(font.fonts ?? {});
					const weightAxis = font.axes?.find((a) => a.tag === 'wght');
					const weights = weightAxis
						? Array.from({ length: 9 }, (_, i) => (i + 1) * 100).filter(
								(w) => w >= weightAxis.min && w <= weightAxis.max
							)
						: [...new Set(styles.map((s) => parseInt(s, 10)).filter(Number.isFinite))];
					return {
						family: font.family,
						weights: weights.length ? weights : [400],
						italic: styles.some((s) => s.includes('i'))
					};
				}
			)
			.filter((f: { family: unknown }) => typeof f.family === 'string');
		return json(families, {
			headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' }
		});
	} catch {
		return json(
			{ error: 'Google Fonts catalog is unavailable. Enter a family name directly.' },
			{ status: 502 }
		);
	}
}
