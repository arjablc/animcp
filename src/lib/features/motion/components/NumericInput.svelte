<script lang="ts">
	import { tick } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	let {
		value,
		label,
		step = 1,
		min = -1e6,
		max = 1e6,
		disabled = false,
		oncommit,
		onpreview,
		onbegin
	}: {
		value: number;
		label: string;
		step?: number;
		min?: number;
		max?: number;
		disabled?: boolean;
		oncommit: (value: number) => void;
		onpreview?: (value: number | null) => void;
		onbegin?: () => void;
	} = $props();
	let input = $state<HTMLInputElement | null>(null),
		editing = $state(false),
		draft = $state(''),
		drag = $state<{ x: number; initial: number; value: number; moved: boolean } | null>(null);
	$effect(() => {
		if (!editing && !drag) draft = String(Math.round(value * 10000) / 10000);
	});
	const bounded = (n: number) => Math.round(Math.max(min, Math.min(max, n)) * 10000) / 10000;
	function start(e: PointerEvent) {
		if (disabled || editing || e.button !== 0) return;
		onbegin?.();
		drag = { x: e.clientX, initial: value, value, moved: false };
		if (e.currentTarget instanceof HTMLElement) e.currentTarget.setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		if (!drag.moved && Math.abs(dx) < 3) return;
		const next = bounded(drag.initial + dx * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1));
		drag = { ...drag, moved: true, value: next };
		draft = String(next);
		onpreview?.(next);
	}
	async function finish() {
		const d = drag;
		drag = null;
		if (!d) return;
		if (d.moved) {
			onpreview?.(null);
			oncommit(d.value);
			draft = String(d.value);
		} else {
			editing = true;
			draft = String(value);
			await tick();
			input?.focus();
			input?.select();
		}
	}
	function commit() {
		if (!editing) return;
		editing = false;
		const n = Number(draft);
		if (draft.trim() && Number.isFinite(n)) {
			const next = bounded(n);
			draft = String(next);
			if (next !== value) oncommit(next);
		} else draft = String(value);
	}
	function cancel() {
		drag = null;
		editing = false;
		draft = String(value);
		onpreview?.(null);
	}
	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
			input?.blur();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (editing) {
				commit();
				input?.blur();
			} else {
				onbegin?.();
				editing = true;
				draft = String(value);
				tick().then(() => input?.select());
			}
		} else if (!editing && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
			e.preventDefault();
			onbegin?.();
			oncommit(
				bounded(
					value +
						(['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1) * step * (e.shiftKey ? 10 : 1)
				)
			);
		}
	}
</script>

<Input
	bind:ref={input}
	class={`numeric-input ${editing ? 'is-editing' : ''}`}
	type="text"
	inputmode="decimal"
	role="spinbutton"
	aria-label={label}
	aria-valuenow={drag?.value ?? value}
	aria-valuemin={min}
	aria-valuemax={max}
	title={`${label} · drag to adjust, click to type · Shift ×10, Alt ×0.1`}
	readonly={!editing}
	{disabled}
	value={draft}
	oninput={(e) => (draft = e.currentTarget.value)}
	onblur={commit}
	onkeydown={key}
	onpointerdown={start}
	onpointermove={move}
	onpointerup={finish}
	onpointercancel={cancel}
/>

<style>
	:global(.numeric-input) {
		height: 30px !important;
		min-width: 0;
		width: 100%;
		padding: 4px 7px !important;
		background: var(--surface-control) !important;
		border: 1px solid transparent !important;
		border-radius: 5px !important;
		color: var(--paper) !important;
		text-align: left;
		font:
			11px 'DM Mono',
			monospace !important;
		cursor: ew-resize;
		touch-action: none;
		box-shadow: none !important;
	}
	:global(.numeric-input:hover) {
		background: var(--surface-selected) !important;
	}
	:global(.numeric-input.is-editing) {
		cursor: text;
		border-color: var(--acid) !important;
	}
	:global(.numeric-input:focus-visible) {
		outline: 1px solid var(--acid);
		outline-offset: 1px;
	}
</style>
