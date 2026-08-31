import type { AnimationProject } from './model';
import { parseProject } from './validation';

export const CURRENT_PROJECT_VERSION = 1 as const;

/** V1 is the first vector schema. Legacy p5 and unknown versions are deliberately rejected.
 * This pure boundary returns a new document and leaves the source available for recovery.
 */
export function migrateProject(document: unknown): AnimationProject {
	return parseProject(document);
}
