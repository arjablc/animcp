import { check, evaluate, type Layer, type Project } from './model';
import { loadFont } from './fonts';
import { clamp } from './render';
/** Rasterizes only static content for explicit export fallback. Project artwork stays unchanged. */
export async function rasterizeContent(p: Project, l: Layer): Promise<string> {
	const n = (prop: string) => Number(evaluate(l.tracks[prop], 0));
	const w = Math.ceil(n('width')),
		h = Math.ceil(n('height'));
	check(
		w > 0 && h > 0 && w <= 8192 && h <= 8192 && w * h <= 16e6,
		`Export bitmap for ${l.name} exceeds pixel limits`
	);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;
	if (l.type === 'text') {
		await loadFont(l.fontFamily, l.fontWeight, l.fontStyle, l.text);
		ctx.font = `${l.fontStyle} ${l.fontWeight} ${l.fontSize}px ${JSON.stringify(l.fontFamily)}`;
		let fill: string | CanvasGradient = String(evaluate(l.tracks.fill, 0));
		if (l.paint.type !== 'solid') {
			const gradient =
				l.paint.type === 'linear'
					? ctx.createLinearGradient(
							n('gradient.startX') * w,
							n('gradient.startY') * h,
							n('gradient.endX') * w,
							n('gradient.endY') * h
						)
					: ctx.createRadialGradient(
							n('gradient.focalX') * w,
							n('gradient.focalY') * h,
							0,
							n('gradient.centerX') * w,
							n('gradient.centerY') * h,
							Math.max(0.001, n('gradient.radius')) * Math.min(w, h)
						);
			for (const stop of l.paint.stops
				.map((id) => ({ id, offset: clamp(n(`gradient.stop.${id}.offset`)) }))
				.sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id))) {
				const color = String(evaluate(l.tracks[`gradient.stop.${stop.id}.color`], 0));
				const alpha = Math.round(clamp(n(`gradient.stop.${stop.id}.opacity`)) * 255)
					.toString(16)
					.padStart(2, '0');
				gradient.addColorStop(stop.offset, color + alpha);
			}
			fill = gradient;
		}
		ctx.fillStyle = fill;
		ctx.strokeStyle = String(evaluate(l.tracks.stroke, 0));
		ctx.lineWidth = n('strokeWidth');
		for (const [index, line] of l.text.split('\n').entries()) {
			const metrics = ctx.measureText(line),
				y = l.fontSize * (1 + index * 1.2);
			check(
				metrics.actualBoundingBoxLeft <= 0.5 &&
					metrics.actualBoundingBoxRight <= w &&
					y + metrics.actualBoundingBoxDescent <= h,
				`Text “${l.name}” exceeds its export bounds. Increase width/height before Lottie export.`
			);
			ctx.globalAlpha = clamp(n('paintOpacity'));
			ctx.fillText(line, 0, y);
			ctx.globalAlpha = 1;
			if (ctx.lineWidth > 0) ctx.strokeText(line, 0, y);
		}
	} else {
		const asset = p.assets.find((a) => a.id === l.assetId);
		check(asset, 'Missing artwork');
		const img = new Image();
		img.src = asset.data;
		await img.decode();
		const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
		const iw = img.naturalWidth * scale,
			ih = img.naturalHeight * scale;
		ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
	}
	return canvas.toDataURL('image/png');
}
