import { createAnimationProject, type AnimationProject } from './model';
import { createAnimationCommands } from './commands';
import { createAutosaver, type AutosaveStatus } from '../persistence/vector-storage';

/** One session per editor route; nothing is shared across project mounts or SSR requests. */
export class VectorSession {
	project = $state.raw<AnimationProject>(createAnimationProject());
	currentFrame = $state(0);
	selectedLayerId = $state<string | null>(null);
	playing = $state(false);
	tool = $state<'select' | 'pencil' | 'pen' | 'hand'>('select');
	stroke = $state('#00c3ff');
	strokeWidth = $state(4);
	zoom = $state(1);
	fitToken = $state(0);
	selectedPoint = $state(0);
	error = $state('');
	webmcp = $state('Checking agent connection…');
	saveStatus = $state<AutosaveStatus | undefined>();
	historyVersion = $state(0);
	readonly saver;
	readonly commands;
	constructor(project: AnimationProject) {
		this.project = project;
		this.saver = createAutosaver({
			onStatus: (status) => {
				this.saveStatus = status;
			}
		});
		this.commands = createAnimationCommands({
			getProject: () => this.project,
			setProject: (next) => {
				this.project = next;
				this.historyVersion++;
				this.currentFrame = Math.min(this.currentFrame, next.timeline.frameCount - 1);
				if (!next.layers.some((layer) => layer.id === this.selectedLayerId))
					this.selectedLayerId = null;
				this.saver.schedule(next);
			}
		});
	}
	execute(name: string, input: Record<string, unknown> = {}, expectedRevision?: number) {
		this.error = '';
		const result = this.commands.execute(name, input, expectedRevision);
		if (!result.ok) throw Object.assign(new Error(result.message), result);
		return result;
	}
	seek(frame: number) {
		if (!Number.isInteger(frame) || frame < 0 || frame >= this.project.timeline.frameCount)
			throw new Error('Frame is outside the timeline.');
		this.currentFrame = frame;
	}
	select(id: string | null) {
		if (id !== null && !this.project.layers.some((layer) => layer.id === id))
			throw new Error('Layer does not exist.');
		this.selectedLayerId = id;
		this.selectedPoint = 0;
	}
	play(action: 'play' | 'pause' | 'restart') {
		if (action === 'restart') this.currentFrame = 0;
		this.playing = action !== 'pause';
	}
	undo() {
		const result = this.commands.undo();
		if (!result.ok) throw new Error(result.message);
		return result;
	}
	redo() {
		const result = this.commands.redo();
		if (!result.ok) throw new Error(result.message);
		return result;
	}
	get canUndo() {
		this.historyVersion;
		return this.commands.canUndo;
	}
	get canRedo() {
		this.historyVersion;
		return this.commands.canRedo;
	}
	get selectedLayer() {
		return this.project.layers.find((layer) => layer.id === this.selectedLayerId);
	}
}
