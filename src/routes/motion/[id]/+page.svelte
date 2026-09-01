<script lang="ts">
	import MotionEditor from '$lib/features/motion/components/MotionEditor.svelte';
	let { data } = $props<{ data: { id: string } }>();
</script>

<MotionEditor id={data.id} />
