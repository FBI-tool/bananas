<script lang="ts">
  import { toast } from './toastState.svelte'

  const alertClass = $derived(
    toast.type === 'success'
      ? 'alert-success'
      : toast.type === 'error'
        ? 'alert-error'
        : 'alert-info'
  )
</script>

{#if toast.visible}
  <div class="toast toast-top toast-end z-50">
    <div class="alert {alertClass}">
      <span>{toast.message}</span>
    </div>
  </div>
{/if}
