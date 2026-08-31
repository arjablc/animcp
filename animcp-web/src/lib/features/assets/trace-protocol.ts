import type { PathData } from '../animation/model';
import type { AssetErrorCode } from './limits';
import type { TraceOptions } from './trace-algorithm';

export type TraceRequest = { type: 'trace'; blob: Blob; options: TraceOptions };
export type TraceResponse =
	| { type: 'progress'; fraction: number }
	| { type: 'result'; path: PathData }
	| { type: 'error'; code: AssetErrorCode; message: string };
