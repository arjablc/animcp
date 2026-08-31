<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import { controlGroups, type ConfigObject, type ConfigValue, type SchemaNode } from './schema';

	let { schema, config, onchange } = $props<{
		schema: SchemaNode;
		config: ConfigObject;
		onchange: (path: string[], value: unknown) => void;
	}>();

	// `$derived` recalculates whenever a prop it reads changes; no manual listener is needed.
	let groups = $derived(controlGroups(schema, config));

	function inputValue(event: Event) {
		return (event.currentTarget as HTMLInputElement).value;
	}

	function numericValue(event: Event) {
		return Number(inputValue(event));
	}

	function enumValue(raw: string, values: Array<string | number | boolean>): ConfigValue {
		return values.find((value) => String(value) === raw) ?? raw;
	}
</script>

{#if groups.length === 0}
	<p class="empty-note">This sketch has no editable properties.</p>
{/if}

{#each groups as group (group.title)}
	<fieldset>
		<legend>{group.title}</legend>
		{#each group.fields as field (field.path.join('.'))}
			<label class:color-field={field.schema.format === 'color'}>
				<span>{field.label}</span>
				{#if field.schema.description}<small>{field.schema.description}</small>{/if}
				{#if field.schema.readOnly}
					<output>{String(field.value)}</output>
				{:else if field.schema.enum}
					<NativeSelect.Root
						value={String(field.value)}
						onchange={(event) =>
							onchange(field.path, enumValue(event.currentTarget.value, field.schema.enum!))}
					>
						{#each field.schema.enum as option (option)}<option value={String(option)}
								>{String(option)}</option
							>{/each}
					</NativeSelect.Root>
				{:else if field.schema.type === 'boolean'}
					<input
						type="checkbox"
						checked={field.value as boolean}
						onchange={(event) => onchange(field.path, event.currentTarget.checked)}
					/>
				{:else if field.schema.format === 'color'}
					<span class="color-control">
						<input
							type="color"
							value={field.value as string}
							oninput={(event) => onchange(field.path, inputValue(event))}
						/>
						<code>{String(field.value)}</code>
					</span>
				{:else if field.schema.type === 'number' || field.schema.type === 'integer'}
					<Input
						type="number"
						value={field.value as number}
						min={field.schema.minimum}
						max={field.schema.maximum}
						step={field.schema.multipleOf ?? (field.schema.type === 'integer' ? 1 : 'any')}
						oninput={(event) => onchange(field.path, numericValue(event))}
					/>
				{:else}
					<Input
						type="text"
						value={field.value as string}
						oninput={(event) => onchange(field.path, inputValue(event))}
					/>
				{/if}
			</label>
		{/each}
	</fieldset>
{/each}

<style>
	fieldset {
		border: 0;
		border-top: 1px solid var(--line);
		margin: 0;
		padding: 20px;
	}
	legend {
		color: var(--acid);
		font: 700 0.72rem/1 var(--mono);
		letter-spacing: 0.12em;
		padding-right: 10px;
		text-transform: uppercase;
	}
	label {
		display: grid;
		gap: 7px;
		margin: 0 0 18px;
		color: var(--muted);
		font-size: 0.78rem;
	}
	label > span:first-child {
		color: var(--paper);
		font-weight: 650;
	}
	small {
		line-height: 1.35;
	}
	input,
	:global([data-slot='input']),
	:global([data-slot='native-select']),
	output {
		width: 100%;
		border: 1px solid var(--line-bright);
		border-radius: 7px;
		background: #171a15;
		color: var(--paper);
		padding: 9px 10px;
		font: inherit;
	}
	input:focus,
	:global([data-slot='input']:focus),
	:global([data-slot='native-select']:focus) {
		border-color: var(--acid);
		outline: 2px solid color-mix(in srgb, var(--acid) 24%, transparent);
	}
	input[type='checkbox'] {
		width: 20px;
		height: 20px;
		accent-color: var(--acid);
	}
	input[type='color'] {
		width: 42px;
		height: 34px;
		padding: 3px;
	}
	.color-control {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.color-control code {
		color: var(--muted);
		font-family: var(--mono);
	}
	.empty-note {
		color: var(--muted);
		padding: 20px;
	}
</style>
