<script lang="ts">
	import MotionEditor from '$lib/features/motion/MotionEditor.svelte';
	let { data } = $props<{ data: { id: string } }>();
</script>

<MotionEditor id={data.id} />
