<script lang="ts">
  import { L } from './translations'
  import type { SessionEndedReason } from './session/roomLogic'

  let {
    reason,
    onDismiss
  }: {
    reason: SessionEndedReason | null
    onDismiss: () => void
  } = $props()

  const title = $derived(
    reason === 'removed'
      ? L.removed_from_session()
      : reason === 'host-ended'
        ? L.host_ended_the_session()
        : L.everyone_else_has_left()
  )
</script>

{#if reason}
  <div class="session-ended-overlay">
    <div class="card bg-base-100 shadow-xl max-w-md w-full mx-4">
      <div class="card-body items-center text-center">
        <h2 class="card-title">{title}</h2>
        <div class="card-actions mt-2">
          <button class="btn btn-primary" onclick={onDismiss}>{L.dismiss()}</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .session-ended-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
    background: rgb(0 0 0 / 40%);
  }
</style>
