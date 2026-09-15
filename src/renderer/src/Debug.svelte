<script lang="ts">
  import { L } from './translations'
  import { debugLog } from './debugLog.svelte'

  let scroller: HTMLDivElement | undefined = $state()

  $effect(() => {
    void debugLog.entries.length
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  })

  const copyLogs = (): void => {
    void navigator.clipboard.writeText(debugLog.toText())
  }

  const levelClass = (level: string): string => {
    if (level === 'error') return 'text-error'
    if (level === 'warn') return 'text-warning'
    return 'text-base-content'
  }

  const formatTime = (at: number): string => new Date(at).toLocaleTimeString()
</script>

<div class="container mx-auto p-5 flex flex-col gap-4 h-[calc(100vh-5rem)]">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h1 class="text-3xl font-bold">{L.debug()}</h1>
    <div class="flex gap-2">
      <button class="btn btn-ghost" onclick={() => debugLog.clear()}>{L.debug_clear()}</button>
      <button class="btn btn-primary" onclick={copyLogs} disabled={debugLog.entries.length === 0}>
        {L.debug_copy()}
      </button>
    </div>
  </div>

  <div bind:this={scroller} class="flex-1 overflow-auto rounded-box bg-base-300 p-3 font-mono text-xs">
    {#if debugLog.entries.length === 0}
      <p class="opacity-60">{L.debug_empty()}</p>
    {:else}
      {#each debugLog.entries as entry (entry.id)}
        <div class="mb-3 whitespace-pre-wrap break-all {levelClass(entry.level)}">
          <span class="opacity-60">{formatTime(entry.at)}</span>
          <span class="uppercase font-semibold"> [{entry.level}]</span>
          <span> [{entry.scope}] {entry.message}</span>
          {#if entry.detail}
            <pre class="mt-1 opacity-80">{entry.detail}</pre>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
