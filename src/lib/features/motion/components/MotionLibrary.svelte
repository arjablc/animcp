<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { listMotion, saveMotion, deleteMotion } from '../storage';
	import { importNative } from '../assets';
	import { uid } from '../model';
	import { migrateVector } from '../migrate';
	import { templates } from '../templates';
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
			<h1>Make your next <em>move.</em></h1>
			<p>
				A timeline you and your agent can work on together. Create the composition. Shape the
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
		gap: 0 28px;
	}
	.template-grid a {
		padding: 18px 0;
		border-bottom: 1px solid var(--line);
	}
	.template-grid strong {
		font-size: 12px;
		color: var(--paper);
	}
	.template-grid p {
		font-size: var(--type-label);
		color: var(--muted);
		line-height: 1.7;
		margin-top: 10px;
	}
	:global(body) {
		margin: 0;
	}
	main {
		min-height: 100vh;
		background: #0d1522;
		color: var(--paper);
		padding: 0 max(28px, calc((100vw - 1220px) / 2));
		font-family: var(--sans);
		--landing-accent: #8fcad8;
		--landing-panel: #162337;
		--landing-raised: #1b2a3e;
		--landing-line: #31445a;
	}
	nav {
		height: 92px;
		border-bottom: 1px solid var(--line);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	a {
		text-decoration: none;
		color: inherit;
	}
	.brand {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.04em;
	}
	.brand span {
		color: var(--landing-accent);
	}
	.brand small {
		font: 500 var(--type-meta) / 1 var(--mono);
		color: var(--muted);
		letter-spacing: 2px;
		margin-left: 22px;
	}
	.hero {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: clamp(48px, 7vw, 88px);
		align-items: center;
		padding: 92px 0 104px;
	}
	h1 {
		max-width: 12ch;
		font-size: clamp(3rem, 5vw, 4.25rem);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1.06;
		margin: 0 0 28px;
	}
	h1 em {
		font-style: normal;
		color: inherit;
	}
	.copy p {
		max-width: 58ch;
		font-size: var(--type-body);
		color: var(--muted);
		line-height: var(--leading-body);
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
		font-size: var(--type-control);
		border: 1px solid var(--landing-line);
	}
	.primary {
		background: var(--landing-accent);
		color: var(--acid-ink);
		border-color: var(--landing-accent);
		font-weight: 600;
	}
	.secondary,
	button {
		background: transparent;
		color: #c7d3e0;
	}
	.copy > small {
		font: 400 var(--type-meta) / 1.4 var(--mono);
		color: var(--muted);
	}
	.preview {
		background: var(--landing-panel);
		padding: 28px;
		border: 1px solid var(--landing-line);
		border-radius: 12px;
	}
	.preview-label {
		display: flex;
		justify-content: space-between;
		font: 500 var(--type-meta) / 1 var(--mono);
		color: var(--muted);
		letter-spacing: 1px;
	}
	.preview h2 {
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.02em;
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
		background: #20344c;
		height: 100px;
		padding: 14px;
		color: var(--paper);
		font-weight: 600;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		font-size: 13px;
	}
	.cards > div:nth-child(2) {
		background: #243a52;
	}
	.cards > div:nth-child(3) {
		background: #293f57;
	}
	.cards span {
		font: 400 var(--type-meta) / 1 var(--mono);
		opacity: 0.6;
	}
	.mini-timeline {
		display: flex;
		color: var(--muted);
		font: 400 var(--type-meta) / 1.4 var(--mono);
		align-items: center;
		margin: 10px 0;
		border-bottom: 1px solid var(--line);
		padding-bottom: 7px;
	}
	.mini-timeline i {
		font-style: normal;
		color: #789bb9;
		margin-left: auto;
		width: 60%;
		box-sizing: border-box;
	}
	.agent-note {
		margin-top: 22px;
		padding: 12px;
		border: 1px solid var(--landing-line);
		background: var(--landing-raised);
		border-radius: 6px;
		font-size: var(--type-label);
		color: var(--paper);
	}
	.projects {
		border-top: 1px solid var(--line);
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
		font: 500 var(--type-label) / 1 var(--mono);
		color: var(--muted);
		margin-left: 10px;
	}
	.heading p {
		max-width: 65ch;
		color: var(--muted);
		font-size: var(--type-control);
		line-height: var(--leading-compact);
	}
	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
		gap: 20px;
	}
	.new {
		min-height: 220px;
		border: 1px dashed var(--landing-line);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		font-size: 12px;
		color: var(--paper);
		gap: 20px;
	}
	.new > span {
		font-size: 35px;
		color: var(--muted);
	}
	article {
		border: 1px solid var(--line);
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
		font: 500 2.5rem/1 var(--mono);
		color: var(--paper);
	}
	.thumb small {
		display: block;
		font: 500 var(--type-meta) / 1 var(--mono);
		color: var(--muted);
		margin-top: 6px;
		letter-spacing: 2px;
	}
	article h3 {
		font-size: 12px;
		margin: 16px 16px 6px;
	}
	article p {
		font: 400 var(--type-meta) / 1.4 var(--mono);
		color: var(--muted);
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
		border-top: 1px solid var(--line);
		padding: 26px 0;
		display: flex;
		gap: 25px;
		font: 500 var(--type-meta) / 1.4 var(--mono);
		color: var(--muted);
	}
	footer span:first-child {
		flex: 1;
	}
	@media (max-width: 850px) {
		.hero {
			grid-template-columns: 1fr;
			gap: 40px;
			padding: 64px 0 72px;
		}
		.preview {
			max-width: 500px;
		}
		.brand small {
			display: none;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.preview {
			animation: settle 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		@keyframes settle {
			from {
				transform: translateY(12px);
				filter: blur(3px);
			}
			to {
				transform: translateY(0);
				filter: blur(0);
			}
		}
	}
</style>
