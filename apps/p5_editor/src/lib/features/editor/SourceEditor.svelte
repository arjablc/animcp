<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";

  // `$bindable` lets the parent use `bind:value`, similar to a two-way controlled field.
  let { value = $bindable(), dirty, onapply } = $props<{
    value: string;
    dirty: boolean;
    onapply: () => void;
  }>();
</script>

<div class="source-head">
  <span>sketch.js</span>
  <Button class="apply" disabled={!dirty} onclick={onapply}>Apply source</Button>
</div>
<Textarea class="source-input" bind:value spellcheck="false" aria-label="p5.js sketch source" />

<style>
  .source-head { height: 48px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); padding: 0 14px 0 18px; color: var(--muted); font: 600 0.76rem/1 var(--mono); }
  :global(.source-input) { display: block; width: 100%; height: calc(100% - 48px); min-height: 360px; resize: none; border: 0; border-radius: 0; background: #0d0f0c; color: #e8eadf; padding: 20px; font: 0.78rem/1.65 var(--mono); tab-size: 2; outline: none; }
  :global(.source-input:focus-visible) { box-shadow: inset 3px 0 var(--acid); }
  :global(.apply) { height: auto; border: 1px solid var(--acid); border-radius: 99px; background: var(--acid); color: #11140f; padding: 7px 12px; font: 750 0.7rem/1 var(--sans); }
  :global(.apply:disabled) { border-color: var(--line-bright); background: transparent; color: #656a60; }
</style>
