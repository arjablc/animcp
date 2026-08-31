# Local raster assets

Import all three public APIs from `$lib/features/assets/raster` (also exported by the directory index).
Nothing here mutates a project, writes storage, loads a remote URL, or accepts/render-parses SVG.

```ts
const { asset, blob } = await prepareRasterAsset(file, file.name, 'file', signal);
await putAsset(projectId, asset.id, blob); // features/persistence/vector-storage
// Then commit asset metadata through the shared command layer.

const transport = decodeBase64Asset({
	mimeType: 'image/png', // or image/jpeg / image/webp
	name: 'Sketch.png',
	dataBase64: rawBase64 // canonical RFC 4648, including required padding; no data: prefix
});
const imported = await prepareRasterAsset(transport.blob, transport.name, 'webmcp', signal);

const preview = await traceRaster(
	blob,
	{ threshold: 128, maxDimension: 512 },
	signal,
	(fraction) => {
		progress = fraction;
	}
); // 0..1
// Render preview with a fill, and commit paths: [preview] only after acceptance.
// AbortController.abort() discards the job by terminating its dedicated worker.
```

`prepareRasterAsset(blob, name, source = 'file', signal?)` returns
`Promise<{ asset: AssetRecord, blob: Blob }>` using the core `animation/model` type.
The metadata's `blobKey` equals `asset.id`; persistence is scoped by `(projectId, asset.id)`.
Use the returned normalized Blob. An empty File/Blob MIME is inferred from its signature;
nonempty MIME claims must match. Names are trimmed and limited to 200 characters.

`decodeBase64Asset(input: unknown)` returns `{ blob: Blob, name: string }` synchronously.
All three fields shown above are required. Optional `expectedRevision` and `requestId` command metadata
are validated and ignored, so the WebMCP adapter can pass its complete input. Other extra fields and
accessors are rejected. The alternate explicit `{ encoding: 'base64', mimeType, name, data }` shape is
also accepted, but mixing the two shapes is rejected. It checks
transport size/encoding, MIME, signature, container structure and header dimensions. It does
**not** prove browser decodability; always follow it with `prepareRasterAsset` before persistence.

Both compressed file bytes and the decoded RGBA surface (`width * height * 4`) are capped at
10 MiB, with an additional 16384px per-side cap. Container scans are bounded. PNG, baseline /
progressive JPEG, lossy/lossless WebP are supported; animated PNG/WebP are intentionally rejected.
Header checks are not full codecs: actual browser decoding verifies decodability, and decoded
dimensions must match the header (including an orientation swap). `createImageBitmap` is required.
Decode waits time out after 15 seconds. Cancellation rejects with `AbortError`; a browser decode
already in flight cannot itself be interrupted, but any eventual bitmap is closed. No object
URLs are created. Pixel/file budgets bound input and RGBA surface size, not all browser codec memory.

`traceRaster(blob, options?, signal?, onProgress?)` returns `Promise<PathData>` without committing
anything. The dedicated module worker validates and decodes the original Blob, samples to at most
512px per side, traces foreground pixel boundaries and removes collinear vertices. Geometry is
scaled back into the **decoded source image's coordinates**; the UI may separately fit/transform it.
Disconnected regions and holes are multiple closed M/L/Z contours inside **one** path. Opposing hole
winding supports nonzero fill. No SVG intermediary, WASM claim, or additional dependency is involved.

Options (all optional, validated):

- `threshold`: integer 0–255, default 128; luminance at/below it is foreground.
- `alphaThreshold`: integer 0–255, default 128; lower alpha is excluded, and alpha 0 is always excluded.
- `mode`: `luminance` (default) or `alpha` for color-independent silhouettes.
- `invert`: boolean, default false; luminance foreground becomes strictly above the threshold.
- `maxDimension`: integer 1–512, default 512; longest sampling side.
- `maxCommands`: integer 5–10000, default 10000; may only lower the hard output cap, counting M and Z.

This is **monochrome pixel contour tracing, not color tracing, curve fitting, or semantic segmentation**.
It preserves pixel corners rather than smoothing them. Downsampling may remove small details.
`TRACE_LIMITATIONS` exports a suitable UI disclosure. Empty masks and excessive contour complexity
produce actionable errors; no partial/truncated path is returned. Lowering `maxDimension` or adjusting
thresholds lets the user retry. The source Blob is unchanged. Only the final preview path is returned;
intermediate callbacks report progress, not partial geometry.

Workers and worker `OffscreenCanvas`/`createImageBitmap` support are required, with no main-thread
tracing fallback. Every request has a dedicated worker and a 30-second timeout; completion, failure,
cancel, and timeout all terminate it and remove listeners. Route teardown and superseded previews
should abort their signals. Non-cancellation errors have human-readable messages; `AssetError.code`
provides categories such as `size-limit`, `complexity`, `empty-trace`, `unavailable`, and `timeout`.
