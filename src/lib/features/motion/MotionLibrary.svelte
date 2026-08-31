<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listMotion, saveMotion, deleteMotion } from './storage';
	import { importNative } from './assets';
	import { uid } from './model';
	import { migrateVector } from './migrate';
	import { templates } from './templates';
	let projects = $state<Awaited<ReturnType<typeof listMotion>>>([]),
		error = $state(''),
		busy = $state(false);
	let picker: HTMLInputElement;
	async function refresh() {
		try {
			projects = await listMotion();
		} catch (e) {
			error = String(e);
		}
	}
	onMount(() => {
		void refresh();
	});
	async function imported(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = true;
		try {
			if (file.size > 50 * 1024 * 1024) throw new Error('Project exceeds 50 MiB');
			const header = JSON.parse(await file.text());
			const p = header.version === 1 ? migrateVector(header) : await importNative(file);
			p.id = uid();
			p.revision = 0;
			p.updatedAt = new Date().toISOString();
			await saveMotion(p);
			await goto(`/motion/${p.id}`);
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
			picker.value = '';
		}
	}
	async function remove(id: string, name: string) {
		if (!confirm(`Delete “${name}” from this device? Export a backup first.`)) return;
		try {
			await deleteMotion(id);
			await refresh();
		} catch (e) {
			error = String(e);
		}
	}
</script>

<svelte:head
	><title>AniMCP — Make your next move</title><meta
		name="description"
		content="A motion graphics timeline for humans and agents. Animate properties, import SVG and PNG, and surgically revise motion through WebMCP."
	/></svelte:head
>
<main>
	<nav>
		<a class="brand" href="/">ani<span>MCP</span><small>MOTION STUDIO</small></a>
	</nav>
	<section class="hero">
		<div class="copy">
			<div class="eyebrow">HUMAN INTENT. PRECISE MOTION.</div>
			<h1>Make your<br />next <em>move.</em></h1>
			<p>
				A timeline you and your agent can work on together.<br />Create the composition. Shape the
				rhythm. Keep control.
			</p>
			<div class="actions">
				<a class="primary" href="/motion/new">＋ New composition</a><a
					class="secondary"
					href="/motion/demo">Fix this animation ↗</a
				>
			</div>
			<small>Local-first · No account · SVG & PNG · Google Fonts</small>
		</div>
		<div class="preview">
			<div class="preview-label">PRODUCT CARDS <span>00:01 / 00:05</span></div>
			<h2>Ideas into motion.</h2>
			<div class="cards">
				<div>Design<span>01</span></div>
				<div>Animate<span>02</span></div>
				<div>Ship<span>03</span></div>
			</div>
			<div class="mini-timeline">Title <i>◆━━━━◆</i></div>
			<div class="mini-timeline">Design <i style="padding-left:25px">◆━━━━◆</i></div>
			<div class="mini-timeline">Animate <i style="padding-left:50px">◆━━━━◆</i></div>
			<div class="mini-timeline">Ship <i style="padding-left:75px">◆━━━━◆</i></div>
			<div class="agent-note">✦ “Stagger these four frames apart.”</div>
		</div>
	</section>
	<section class="templates" aria-label="Starter templates">
		<div class="heading"><h2>Start with motion. Make it yours.</h2></div>
		<div class="template-grid">
			{#each templates as template}<a href={`/motion/template-${template.id}`}
					><strong>{template.name} ↗</strong>
					<p>{template.description}</p></a
				>{/each}
		</div>
	</section>
	<section class="projects">
		<div class="heading">
			<div>
				<h2>Your compositions <span>{projects.length}</span></h2>
				<p>
					Saved on this device. Ready for the next revision. v1 imports create a separate motion
					copy.
				</p>
			</div>
			<button disabled={busy} onclick={() => picker.click()}>↥ Import .animcp.json</button><input
				bind:this={picker}
				type="file"
				hidden
				accept=".json,.animcp.json"
				onchange={imported}
			/>
		</div>
		{#if error}<p role="alert" class="error">{error}</p>{/if}
		<div class="project-grid">
			<a class="new" href="/motion/new"><span>＋</span>Start with a blank canvas</a
			>{#each projects as p}<article>
					<a href={`/motion/${p.id}`}
						><div class="thumb" style:background={p.composition.background}>
							<b>{String(p.layerCount).padStart(2, '0')}</b><small>MOTION LAYERS</small>
						</div>
						<h3>{p.name}</h3>
						<p>{p.composition.width} × {p.composition.height} · {p.composition.fps} fps</p></a
					><button aria-label={`Delete ${p.name}`} onclick={() => remove(p.id, p.name)}>×</button>
				</article>{/each}
		</div>
	</section>
	<footer>
		ANIMCP <span>Keyframes, timing, motion relationships, and revisions.</span><span
			>HUMAN + WEBMCP</span
		>
	</footer>
</main>

<style>
	.templates {
		padding-bottom: 35px;
	}
	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 14px;
	}
	.template-grid a {
		padding: 18px;
		background: #172334;
		border: 1px solid #32455f;
		border-radius: 7px;
	}
	.template-grid strong {
		font-size: 12px;
		color: #dfff4f;
	}
	.template-grid p {
		font-size: 11px;
		color: #8ea3c0;
		line-height: 1.7;
		margin-top: 10px;
	}
	:global(body) {
		margin: 0;
	}
	main {
		min-height: 100vh;
		background: #101722;
		color: #ecf2f8;
		padding: 0 max(28px, calc((100vw - 1220px) / 2));
		font-family: system-ui, sans-serif;
	}
	nav {
		height: 92px;
		border-bottom: 1px solid #2a3749;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	a {
		text-decoration: none;
		color: inherit;
	}
	.brand {
		font-size: 26px;
		font-weight: 800;
		letter-spacing: -1.5px;
	}
	.brand span {
		color: #dfff4f;
	}
	.brand small {
		font: 9px monospace;
		color: #8295af;
		letter-spacing: 2px;
		margin-left: 22px;
	}
	nav > div {
		display: flex;
		gap: 22px;
		font-size: 11px;
		color: #8fa4bf;
	}
	.hero {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 80px;
		align-items: center;
		padding: 76px 0 82px;
	}
	.eyebrow {
		font: 10px monospace;
		letter-spacing: 2px;
		color: #a7bc87;
	}
	h1 {
		font-size: clamp(48px, 5.5vw, 76px);
		font-weight: 750;
		letter-spacing: -4px;
		line-height: 1.02;
		margin: 25px 0;
	}
	h1 em {
		font-style: normal;
		color: #dfff4f;
	}
	.copy p {
		font-size: 13px;
		color: #8ea3c0;
		line-height: 1.9;
	}
	.actions {
		display: flex;
		gap: 12px;
		margin: 28px 0 22px;
	}
	.primary,
	.secondary,
	button {
		border-radius: 6px;
		padding: 12px 16px;
		font-size: 12px;
		border: 1px solid #35465e;
	}
	.primary {
		background: #dfff4f;
		color: #172211;
		border-color: #dfff4f;
		font-weight: 700;
	}
	.secondary,
	button {
		background: #1a2738;
		color: #e0e9f4;
	}
	.copy > small {
		font: 10px monospace;
		color: #657f9f;
	}
	.preview {
		background: #172232;
		padding: 25px;
		border: 1px solid #35465e;
		border-radius: 12px;
		transform: rotate(-2deg);
		box-shadow: 0 30px 70px #0004;
	}
	.preview-label {
		display: flex;
		justify-content: space-between;
		font: 9px monospace;
		color: #849eba;
		letter-spacing: 1px;
	}
	.preview h2 {
		font-size: 27px;
		letter-spacing: -1px;
		margin: 30px 0 20px;
	}
	.cards {
		display: flex;
		gap: 10px;
		margin-bottom: 28px;
	}
	.cards > div {
		flex: 1;
		border-radius: 8px;
		background: linear-gradient(135deg, #dfff4f, #68d5d3);
		height: 100px;
		padding: 14px;
		color: #1a3143;
		font-weight: 650;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		font-size: 13px;
	}
	.cards > div:nth-child(2) {
		background: linear-gradient(135deg, #97b9ff, #6cdef1);
	}
	.cards > div:nth-child(3) {
		background: linear-gradient(135deg, #cbb2fa, #8cb8ff);
	}
	.cards span {
		font: 10px monospace;
		opacity: 0.6;
	}
	.mini-timeline {
		display: flex;
		color: #849eba;
		font: 10px monospace;
		align-items: center;
		margin: 10px 0;
		border-bottom: 1px solid #27374e;
		padding-bottom: 7px;
	}
	.mini-timeline i {
		font-style: normal;
		color: #dfff4f;
		margin-left: auto;
		width: 60%;
		box-sizing: border-box;
	}
	.agent-note {
		margin-top: 22px;
		padding: 12px;
		border: 1px solid #445945;
		background: #263729;
		border-radius: 6px;
		font-size: 11px;
		color: #cbdfa8;
	}
	.projects {
		border-top: 1px solid #2a3749;
		padding: 30px 0 65px;
	}
	.heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}
	h2 {
		font-size: 18px;
		margin: 0;
	}
	.heading h2 span {
		font: 12px monospace;
		color: #8da4c0;
		margin-left: 10px;
	}
	.heading p {
		color: #7f97b5;
		font-size: 11px;
	}
	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
		gap: 20px;
	}
	.new {
		min-height: 220px;
		border: 1px dashed #405873;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		font-size: 12px;
		color: #b5c7dd;
		gap: 20px;
	}
	.new > span {
		font-size: 35px;
		color: #dfff4f;
	}
	article {
		border: 1px solid #32455f;
		border-radius: 8px;
		overflow: hidden;
		position: relative;
	}
	article .thumb {
		height: 145px;
		padding: 22px;
		box-sizing: border-box;
	}
	.thumb b {
		font: 40px monospace;
		color: #dfff4f;
	}
	.thumb small {
		display: block;
		font: 8px monospace;
		color: #8cabc9;
		margin-top: 6px;
		letter-spacing: 2px;
	}
	article h3 {
		font-size: 12px;
		margin: 16px 16px 6px;
	}
	article p {
		font: 10px monospace;
		color: #7c94b2;
		margin: 0 16px 18px;
	}
	article > button {
		position: absolute;
		right: 9px;
		bottom: 14px;
		border: 0;
		background: transparent;
		padding: 5px;
		cursor: pointer;
	}
	.error {
		color: #ffd0ab;
	}
	footer {
		border-top: 1px solid #2a3749;
		padding: 26px 0;
		display: flex;
		gap: 25px;
		font: 9px monospace;
		color: #617b9b;
	}
	footer span:first-child {
		flex: 1;
	}
	@media (max-width: 850px) {
		.hero {
			grid-template-columns: 1fr;
			gap: 40px;
			padding: 45px 0;
		}
		.preview {
			max-width: 500px;
		}
		.brand small {
			display: none;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.cards > div {
			animation: enter 2s both;
		}
		.cards > div:nth-child(2) {
			animation-delay: 0.15s;
		}
		.cards > div:nth-child(3) {
			animation-delay: 0.3s;
		}
		@keyframes enter {
			from {
				opacity: 0;
				transform: translateY(35px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}
	}
</style>
