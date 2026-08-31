import type { AnimationProject } from './model';

// Explicit in-memory handoff allows creating an unsaved project when IndexedDB is unavailable.
// This is not a storage fallback: the editor continues to show the failed durable-save status.
const drafts = new Map<string, AnimationProject>();
export function keepDraft(project: AnimationProject) {
	drafts.set(project.id, project);
}
export function takeDraft(id: string) {
	const project = drafts.get(id);
	drafts.delete(id);
	return project;
}
