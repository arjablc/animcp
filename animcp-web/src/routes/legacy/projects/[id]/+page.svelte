<script lang="ts">
	import EditorPage from '$lib/features/editor/EditorPage.svelte';
	let { data } = $props<{ data: { id: string } }>();
</script>

<EditorPage {data} />
