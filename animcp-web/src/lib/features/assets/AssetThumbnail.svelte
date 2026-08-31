<script lang="ts">
	import { getAsset } from '../persistence/vector-storage';
	let { projectId, assetId, name } = $props<{ projectId: string; assetId: string; name: string }>();
	let url = $state('');
	let error = $state('');
	$effect(() => {
		let active = true;
		let objectUrl = '';
		url = '';
		error = '';
		void getAsset(projectId, assetId)
			.then((blob) => {
				if (!active) return;
				if (!blob) {
					error = 'Source not on this device';
					return;
				}
				objectUrl = URL.createObjectURL(blob);
				url = objectUrl;
			})
			.catch(() => {
				if (active) error = 'Preview unavailable';
			});
		return () => {
			active = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});
</script>

<div class="thumbnail">
	{#if url}<img src={url} alt={name} />{:else}<span>{error || 'Loading preview…'}</span>{/if}
</div>

<style>
	.thumbnail {
		height: 100px;
		display: grid;
		place-items: center;
		background: repeating-conic-gradient(#283139 0 25%, #1c252c 0 50%) 0 0/16px 16px;
		border-radius: 4px;
		overflow: hidden;
	}
	.thumbnail img {
		max-width: 100%;
		max-height: 100px;
		object-fit: contain;
	}
	.thumbnail span {
		font-size: 10px;
		padding: 10px;
		color: #bcc5cb;
	}
</style>
