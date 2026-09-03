import { check, validateProject, type Project, type Value } from './model';
import { transact, type Context, type History, type Operation } from './commands';
import { saveMotion } from './storage';
export class MotionSession {
	project = $state.raw<Project>() as Project;
	context = $state<Context>({
		currentFrame: 0,
		selectedLayerIds: [],
		selectedKeyframeIds: [],
		selectedProperties: [],
		selectedRange: null,
		revision: 0
	});
	playing = $state(false);
	error = $state('');
	saveStatus = $state('Saved locally');
	autoKey = $state(false);
	preview = $state.raw<{ layerId: string; values: Record<string, Value> } | null>(null);
	webmcp = $state('Connecting…');
	history = $state.raw<History[]>([]);
	future = $state.raw<History[]>([]);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private queue = Promise.resolve();
	private disposed = false;
	constructor(p: Project) {
		this.project = validateProject(p);
	}
	commit(
		operations: Operation[],
		label: string,
		actor: History['actor'] = 'human',
		expectedRevision?: number
	) {
		if (expectedRevision !== undefined)
			check(
				expectedRevision === this.project.revision,
				'Revision conflict: read the current project before retrying'
			);
		this.preview = null;
		const before = this.project;
		const result = transact(before, operations);
		this.project = result.project;
		this.history = [...this.history.slice(-49), { label, actor, before, after: this.project }];
		this.future = [];
		this.reconcile();
		this.save();
		const changed = this.project.layers.flatMap((layer) => {
			const old = before.layers.find((l) => l.id === layer.id);
			const properties = Object.entries(layer.tracks)
				.filter(([name, t]) => JSON.stringify(t) !== JSON.stringify(old?.tracks[name]))
				.map(([name]) => name);
			return !old || JSON.stringify(old) !== JSON.stringify(layer)
				? [
						{
							layerId: layer.id,
							properties,
							keyframes: properties.flatMap((property) =>
								layer.tracks[property].keys.map((k) => ({
									id: k.id,
									property,
									frame: k.frame,
									value: k.value
								}))
							)
						}
					]
				: [];
		});
		return {
			revision: this.project.revision,
			data: result.data,
			changed,
			deletedLayerIds: before.layers
				.filter((l) => !this.project.layers.some((n) => n.id === l.id))
				.map((l) => l.id)
		};
	}
	run(name: string, input: Record<string, unknown>, label = name.replaceAll('_', ' ')) {
		return this.commit([{ name, input }], label);
	}
	undo() {
		const entry = this.history.at(-1);
		check(entry, 'Nothing to undo');
		this.project = {
			...structuredClone(entry.before),
			revision: this.project.revision + 1,
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- immediately serialized timestamp
			updatedAt: new Date().toISOString()
		};
		this.history = this.history.slice(0, -1);
		this.future = [...this.future, entry];
		this.reconcile();
		this.save();
	}
	redo() {
		const entry = this.future.at(-1);
		check(entry, 'Nothing to redo');
		this.project = {
			...structuredClone(entry.after),
			revision: this.project.revision + 1,
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- immediately serialized timestamp
			updatedAt: new Date().toISOString()
		};
		this.future = this.future.slice(0, -1);
		this.history = [...this.history, entry];
		this.reconcile();
		this.save();
	}
	select(ids: string[], keys: string[] = [], properties: string[] = []) {
		this.preview = null;
		this.context = {
			...this.context,
			selectedLayerIds: ids,
			selectedKeyframeIds: keys,
			selectedProperties: properties,
			revision: this.context.revision + 1
		};
	}
	seek(frame: number) {
		check(
			Number.isInteger(frame) && frame >= 0 && frame < this.project.composition.durationFrames,
			'Frame is outside the composition'
		);
		this.context = { ...this.context, currentFrame: frame, revision: this.context.revision + 1 };
	}
	private reconcile() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local membership lookup, never observed
		const keys = new Set(
			this.project.layers.flatMap((l) =>
				Object.values(l.tracks).flatMap((t) => t.keys.map((k) => k.id))
			)
		);
		this.context = {
			...this.context,
			currentFrame: Math.min(
				this.context.currentFrame,
				this.project.composition.durationFrames - 1
			),
			selectedLayerIds: this.context.selectedLayerIds.filter((id) =>
				this.project.layers.some((l) => l.id === id)
			),
			selectedKeyframeIds: this.context.selectedKeyframeIds.filter((id) => keys.has(id)),
			revision: this.context.revision + 1
		};
	}
	save() {
		this.saveStatus = 'Saving…';
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), 250);
	}
	flush() {
		clearTimeout(this.timer);
		const snapshot = this.project;
		this.queue = this.queue
			.catch(() => {})
			.then(() => saveMotion(snapshot))
			.then(() => {
				if (!this.disposed && this.project.revision === snapshot.revision)
					this.saveStatus = 'Saved locally';
			})
			.catch((error) => {
				if (!this.disposed) {
					this.saveStatus = 'Save failed — export a backup';
					this.error = String(error);
				}
			});
		return this.queue;
	}
	dispose() {
		void this.flush();
		this.disposed = true;
	}
}
