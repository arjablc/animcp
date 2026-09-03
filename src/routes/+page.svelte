<script lang="ts">
	import { ArrowRight, Check, SlidersHorizontal, Wrench } from '@lucide/svelte';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<meta
		name="description"
		content="Create, revise, and export motion graphics in a local-first timeline—with optional WebMCP agent collaboration."
	/>
</svelte:head>

<main class="landing">
	<nav>
		<a class="brand" href={resolve('/')}>ani<span>MCP</span></a>
		<a class="nav-link" href={resolve('/projects')}>Projects <ArrowRight size={15} /></a>
	</nav>

	<section class="hero">
		<div class="hero-copy">
			<h1>Motion, on <em>your</em> terms.</h1>
			<p>
				A local-first timeline for creating, revising, and exporting motion graphics. Work on your
				own, or use WebMCP to bring an agent into the composition when it helps.
			</p>
			<a class="hero-action" href={resolve('/projects')}
				>Create a project <ArrowRight size={17} /></a
			>
		</div>
		<div class="motion-study" aria-label="An example motion timeline">
			<div class="study-top"><span>PRODUCT INTRO</span><span>00:01:08</span></div>
			<div class="study-canvas">
				<div class="word word-one">IDEA</div>
				<div class="word word-two">MOTION</div>
				<div class="cursor" aria-hidden="true"></div>
			</div>
			<div class="study-timeline">
				<div><span>Title</span><i class="track cyan"></i></div>
				<div><span>Wordmark</span><i class="track blue"></i></div>
				<div><span>Cards</span><i class="track coral"></i></div>
			</div>
		</div>
	</section>

	<section class="agent-section" aria-labelledby="agent-title">
		<div class="agent-intro">
			<h2 id="agent-title">Bring an agent into the timeline.</h2>
			<p>
				In a supported browser, WebMCP lets AniMCP expose specific editor actions to an agent. It
				can inspect the live composition and make focused, undoable timeline edits—not guess at
				pixels.
			</p>
			<a class="text-link" href={resolve('/projects')}
				>Create or open a project <ArrowRight size={15} /></a
			>
		</div>
		<ol class="agent-steps">
			<li>
				<span>01</span>
				<div>
					<h3>Open a project</h3>
					<p>
						Start a blank composition, choose a template, or return to a saved project. Set canvas
						size, frame rate, and background color before you begin.
					</p>
				</div>
			</li>
			<li>
				<span>02</span>
				<div>
					<h3>Confirm WebMCP is ready</h3>
					<p>
						When WebMCP is available, AniMCP registers its editor tools as the studio opens. Check
						the toolbar status before asking your agent to edit.
					</p>
				</div>
			</li>
			<li>
				<span>03</span>
				<div>
					<h3>Request an edit, then review it</h3>
					<p>
						Try “stagger these title layers by four frames” or “make the logo ease out.” Review the
						result in the same timeline, then refine or undo it yourself.
					</p>
				</div>
			</li>
		</ol>
	</section>

	<section class="principles">
		<div>
			<SlidersHorizontal size={20} />
			<h2>Your project stays on this device.</h2>
			<p>
				Projects are stored in this browser on this device. You stay in control of the composition,
				its locks, and its revision history.
			</p>
		</div>
		<div>
			<Wrench size={20} />
			<h2>Purpose-built agent actions.</h2>
			<p>
				An agent gets specific actions for layers, keyframes, timing, and composition settings—not
				broad, opaque control of the page.
			</p>
		</div>
		<div>
			<Check size={20} />
			<h2>Every edit stays legible.</h2>
			<p>
				Agent changes use the same editor controls and undo history as your own work, so you can
				inspect, refine, or reverse them.
			</p>
		</div>
	</section>

	<footer>
		<span>ANIMCP</span><span>A local-first motion timeline for humans + agents.</span><a
			href={resolve('/projects')}>Projects</a
		>
	</footer>
</main>

<style>
	.landing {
		min-height: 100vh;
		background: var(--ink);
		color: var(--paper);
		padding: 0 clamp(24px, 6vw, 104px);
		overflow: hidden;
	}
	:global(.landing ::selection) {
		background: var(--acid);
		color: var(--acid-ink);
	}
	nav {
		height: 88px;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.brand {
		font-size: 24px;
		font-weight: 700;
		letter-spacing: -0.04em;
	}
	.brand span {
		color: var(--acid);
	}
	.nav-link,
	.hero-action,
	.text-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 700;
	}
	.nav-link {
		color: var(--text-muted);
		transition: color 160ms ease;
	}
	.nav-link:hover {
		color: var(--acid);
	}
	.hero {
		max-width: 1240px;
		margin: auto;
		min-height: 610px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(390px, 0.9fr);
		gap: clamp(48px, 9vw, 130px);
		align-items: center;
		padding: 72px 0 88px;
	}
	.hero h1,
	.agent-intro h2 {
		max-width: 8ch;
		margin: 0;
		font-family: var(--display);
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 0.94;
		font-size: clamp(3.5rem, 7vw, 6rem);
	}
	.hero h1 em {
		color: var(--acid);
		font-style: normal;
	}
	.hero-copy p,
	.agent-intro p {
		max-width: 52ch;
		margin: 28px 0;
		color: var(--text-muted);
		font-size: 1.02rem;
		line-height: 1.75;
	}
	.hero-action {
		background: var(--acid);
		color: var(--acid-ink);
		padding: 14px 18px;
		border-radius: 8px;
		transition: transform 160ms ease;
	}
	.hero-action:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 22px #0005;
	}
	.motion-study {
		border: 1px solid var(--line);
		border-radius: 14px;
		background: var(--panel);
		padding: 17px;
		box-shadow: 0 28px 60px #0006;
		isolation: isolate;
	}
	.study-top {
		display: flex;
		justify-content: space-between;
		color: var(--text-muted);
		font: 600 10px/1 var(--mono);
		letter-spacing: 0.11em;
	}
	.study-canvas {
		position: relative;
		height: 257px;
		overflow: hidden;
		margin: 16px 0;
		border-radius: 8px;
		background: var(--sky-300);
		color: var(--navy-850);
	}
	.word {
		position: absolute;
		font-size: clamp(2.5rem, 5vw, 4.5rem);
		font-weight: 700;
		letter-spacing: -0.08em;
	}
	.word-one {
		left: 8%;
		top: 18%;
	}
	.word-two {
		right: 8%;
		bottom: 18%;
		color: var(--navy-600);
	}
	.cursor {
		position: absolute;
		top: 47%;
		left: 53%;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		color: var(--navy-900);
		background: var(--coral);
	}
	.cursor::before {
		content: '';
		position: absolute;
		inset: 8px;
		border-radius: 50%;
		background: var(--navy-850);
	}
	.study-timeline {
		display: grid;
		gap: 9px;
	}
	.study-timeline div {
		display: grid;
		grid-template-columns: 82px 1fr;
		align-items: center;
		color: var(--text-muted);
		font: 10px/1 var(--mono);
	}
	.track {
		display: block;
		height: 9px;
		border-radius: 2px;
		background: var(--acid);
		margin-right: 22%;
	}
	.track.blue {
		margin-left: 16%;
		margin-right: 6%;
		background: var(--info);
	}
	.track.coral {
		margin-left: 34%;
		margin-right: 0;
		background: var(--coral);
	}
	.agent-section {
		max-width: 1240px;
		margin: auto;
		display: grid;
		grid-template-columns: 0.9fr 1.1fr;
		gap: clamp(48px, 10vw, 150px);
		padding: 100px 0;
	}
	.agent-intro h2 {
		font-size: clamp(2.8rem, 4.6vw, 4.5rem);
	}
	.text-link {
		color: var(--acid);
	}
	.agent-steps {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.agent-steps li {
		display: grid;
		grid-template-columns: 62px 1fr;
		gap: 18px;
		padding: 22px 18px;
		border-radius: 10px;
		transition: background 160ms ease;
	}
	.agent-steps li + li {
		margin-top: 8px;
	}
	.agent-steps li:hover {
		background: var(--panel);
	}
	.agent-steps span {
		color: var(--acid);
		font: 11px/1 var(--mono);
	}
	.agent-steps h3 {
		margin: 0 0 8px;
		font-size: 1rem;
	}
	.agent-steps p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.86rem;
		line-height: 1.65;
	}
	.principles {
		max-width: 1240px;
		margin: auto;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 32px;
		padding: 58px 0 100px;
	}
	.principles div {
		padding-top: 0;
		color: var(--acid);
		transition: transform 160ms ease;
	}
	.principles div:hover {
		transform: translateY(-2px);
	}
	.principles h2 {
		margin: 24px 0 12px;
		color: var(--paper);
		font-family: var(--display);
		font-size: 1.08rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.principles p {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.84rem;
		line-height: 1.7;
	}
	footer {
		max-width: 1240px;
		margin: auto;
		display: flex;
		gap: 22px;
		padding: 22px 0;
		color: var(--text-subtle);
		font: 10px/1 var(--mono);
		letter-spacing: 0.08em;
	}
	footer span:nth-child(2) {
		flex: 1;
	}
	footer a {
		color: var(--acid);
	}
	@media (max-width: 800px) {
		.hero,
		.agent-section {
			grid-template-columns: 1fr;
		}
		.hero {
			min-height: auto;
			padding: 70px 0;
		}
		.motion-study {
			max-width: 540px;
		}
		.agent-section {
			padding: 72px 0;
		}
		.principles {
			grid-template-columns: 1fr;
			padding: 30px 0 72px;
		}
		.principles div {
			padding: 22px 0 4px;
		}
	}
	@media (prefers-reduced-motion: no-preference) {
		.motion-study {
			animation: arrive 0.75s cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		@keyframes arrive {
			from {
				transform: translateY(18px);
				filter: blur(4px);
			}
			to {
				transform: translateY(0);
				filter: blur(0);
			}
		}
	}
</style>
