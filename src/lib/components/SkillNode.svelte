<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  interface Props {
    data: { skill: string };
  }

  let { data }: Props = $props();
</script>

<div class="skill-node">
  <Handle type="target" position={Position.Left} />
  <div class="name">{data.skill}</div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .skill-node {
    background: #1e3a5a;
    border: 2px solid #3d7ab0;
    border-radius: 8px;
    color: #e0f0ff;
    min-width: 150px;
    font-size: 13px;
    text-align: center;
    padding: 10px 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .name {
    font-weight: bold;
  }
</style>
