<script lang="ts">
  import { useSvelteFlow } from '@xyflow/svelte';

  let { fitViewPending, onFitViewDone }: {
    fitViewPending: boolean;
    onFitViewDone: () => void;
  } = $props();

  const { fitView } = useSvelteFlow();

  $effect(() => {
    if (fitViewPending) {
      fitView();
      onFitViewDone();
    }
  });
</script>
