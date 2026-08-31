// UI-facing facade. The worker imports raster-input directly so it never bundles its own launcher.
export {
	decodeBase64Asset,
	prepareRasterAsset,
	inspectRaster,
	type RasterHeader,
	type RasterMimeType
} from './raster-input';
export { traceRaster } from './trace';
export { TRACE_LIMITATIONS, type TraceOptions, type TraceProgress } from './trace-algorithm';
export { ASSET_LIMITS, AssetError, type AssetErrorCode } from './limits';
