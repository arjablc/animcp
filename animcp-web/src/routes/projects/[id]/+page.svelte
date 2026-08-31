<script lang="ts">
	import VectorEditor from '$lib/features/editor/VectorEditor.svelte';

	let { data } = $props<{ data: { id: string } }>();
</script>

{#key data.id}<VectorEditor id={data.id} />{/key}
