<script lang="ts">
  import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/svelte';
  import type { EdgeProps } from '@xyflow/svelte';

  interface LabeledEdgeData {
    tooltip?: string;
  }

  let {
    id,
    data,
    label,
    labelStyle,
    style,
    markerStart,
    markerEnd,
    interactionWidth,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  }: EdgeProps = $props();

  const edgeData = $derived((data ?? {}) as LabeledEdgeData);
  const edgePath = $derived(
    getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    })
  );
  const path = $derived(edgePath[0]);
  const labelX = $derived(edgePath[1]);
  const labelY = $derived(edgePath[2]);
</script>

<BaseEdge
  {id}
  {path}
  {markerStart}
  {markerEnd}
  {interactionWidth}
  {style}
/>

{#if label}
  <EdgeLabelRenderer>
    <div
      class="svelte-flow__edge-label edge-label"
      style:transform="translate(-50%, -50%) translate({labelX}px,{labelY}px)"
      style={labelStyle}
      title={edgeData.tooltip}
    >
      {label}
    </div>
  </EdgeLabelRenderer>
{/if}

<style>
  .edge-label {
    pointer-events: all;
    max-width: 180px;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .edge-label[title] {
    cursor: help;
  }
</style>
