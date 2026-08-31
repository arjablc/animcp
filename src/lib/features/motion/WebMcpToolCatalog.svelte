<script lang="ts">
	import { Search, Wrench, ChevronRight } from '@lucide/svelte';
	import type { Tool } from './webmcp';

	let { tools }: { tools: Tool[] } = $props();
	let query = $state('');

	const visibleTools = $derived(
		tools.filter((tool) => {
			const term = query.trim().toLowerCase();
			return !term || `${tool.name} ${tool.description}`.toLowerCase().includes(term);
		})
	);

	function schemaType(schema: Tool['inputSchema']): string {
		if (schema.anyOf) return schema.anyOf.map(schemaType).join(' | ');
		if (schema.enum) return schema.enum.join(' | ');
		return schema.type ?? 'value';
	}
</script>

<div class="tool-catalog" aria-label="Available WebMCP tools">
	<div class="catalog-heading">
		<div><Wrench size={15} /><span>Available WebMCP tools</span></div>
		<strong>{tools.length}</strong>
	</div>
	<p class="catalog-copy">
		Agents can call these tools against this composition. Mutations are revision-checked and
		undoable.
	</p>
	<label class="catalog-search">
		<Search size={14} />
		<input aria-label="Filter WebMCP tools" placeholder="Filter tools…" bind:value={query} />
	</label>
	<div class="tool-list" role="list">
		{#each visibleTools as tool (tool.name)}
			<details class="tool-entry" role="listitem">
				<summary>
					<div>
						<code>{tool.name}</code>
						<p>{tool.description}</p>
					</div>
					<ChevronRight size={14} />
				</summary>
				<div class="tool-schema">
					<div class="schema-title">Input</div>
					{#if tool.inputSchema.properties}
						{#each Object.entries(tool.inputSchema.properties) as [name, schema]}
							<div class="schema-row" class:required={tool.inputSchema.required?.includes(name)}>
								<code>{name}</code><span>{schemaType(schema)}</span>
								{#if tool.inputSchema.required?.includes(name)}<b>required</b>{/if}
							</div>
						{/each}
					{:else}<span class="no-input">No input</span>{/if}
				</div>
			</details>
		{:else}<p class="no-tools">No tools match “{query}”.</p>{/each}
	</div>
</div>

<style>
	.tool-catalog {
		display: flex;
		min-height: 0;
		flex-direction: column;
		gap: 10px;
	}
	.catalog-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: #dcebc9;
		font-size: 12px;
	}
	.catalog-heading > div {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.catalog-heading strong {
		display: grid;
		min-width: 22px;
		height: 20px;
		place-items: center;
		border-radius: 10px;
		background: #3a492f;
		color: #d9f2b3;
		font: 10px monospace;
	}
	.catalog-copy {
		margin: 0;
		color: #92a5bd;
		font-size: 10px;
		line-height: 1.55;
	}
	.catalog-search {
		display: flex;
		align-items: center;
		gap: 7px;
		border: 1px solid #3a4656;
		border-radius: 6px;
		padding: 0 8px;
		color: #8195ad;
		background: #19212b;
	}
	.catalog-search input {
		min-width: 0;
		width: 100%;
		height: 31px;
		border: 0;
		outline: 0;
		background: transparent;
		color: #d9e4ef;
		font:
			11px Inter,
			system-ui,
			sans-serif;
	}
	.tool-list {
		max-height: min(56vh, 430px);
		overflow: auto;
		padding-right: 2px;
	}
	.tool-entry {
		border-bottom: 1px solid #2c3542;
	}
	.tool-entry summary {
		display: flex;
		cursor: pointer;
		list-style: none;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 9px 3px;
	}
	.tool-entry summary::-webkit-details-marker {
		display: none;
	}
	.tool-entry summary > :global(svg) {
		flex: 0 0 auto;
		color: #7f93ab;
		transition: transform 0.15s;
	}
	.tool-entry[open] summary > :global(svg) {
		transform: rotate(90deg);
	}
	.tool-entry code {
		color: #d6efae;
		font:
			10px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
	.tool-entry p {
		margin: 4px 0 0;
		color: #91a3ba;
		font-size: 10px;
		line-height: 1.4;
	}
	.tool-schema {
		margin: 0 0 9px;
		border: 1px solid #344151;
		border-radius: 5px;
		background: #18202a;
		padding: 7px;
	}
	.schema-title {
		margin-bottom: 5px;
		color: #7590ad;
		font:
			9px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.schema-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(50px, 0.8fr) auto;
		gap: 5px;
		align-items: center;
		padding: 3px 0;
		color: #a5b5c7;
		font-size: 9px;
	}
	.schema-row span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #8498b0;
	}
	.schema-row b {
		border-radius: 3px;
		background: #43422d;
		padding: 2px 4px;
		color: #e0eca5;
		font:
			8px ui-monospace,
			SFMono-Regular,
			Menlo,
			monospace;
	}
	.no-input,
	.no-tools {
		color: #8093ab;
		font-size: 10px;
	}
	.no-tools {
		margin: 12px 3px;
	}
</style>
