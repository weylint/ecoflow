<script lang="ts">
  let { data } = $props<{ data: { skill: string } }>();
</script>

<div class="profession-group">
  <div class="group-header">{data.skill}</div>
</div>

<style>
  .profession-group {
    width: 100%;
    height: 100%;
    border: 2px solid #475569;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.4);
    pointer-events: none;
  }

  .group-header {
    position: absolute;
    top: -22px;
    left: 0;
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
