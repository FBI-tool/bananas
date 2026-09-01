<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { ScreenShareSource } from './types'
  import { L } from './translations'

  let visible = $state(false)
  let sources = $state<ScreenShareSource[]>([])
  let selectedId = $state<string | null>(null)
  let resolvePick: ((sourceId: string | null) => void) | null = null

  const screens = $derived(sources.filter((source) => source.isScreen))
  const windows = $derived(sources.filter((source) => !source.isScreen))

  const finish = (sourceId: string | null): void => {
    visible = false
    sources = []
    selectedId = null
    const resolve = resolvePick
    resolvePick = null
    resolve?.(sourceId)
  }

  const onKeyDown = (evt: KeyboardEvent): void => {
    if (!visible) return
    if (evt.key === 'Escape') {
      evt.preventDefault()
      finish(null)
    }
    if (evt.key === 'Enter' && selectedId) {
      evt.preventDefault()
      finish(selectedId)
    }
  }

  export const pick = (nextSources: ScreenShareSource[]): Promise<string | null> => {
    if (resolvePick) finish(null)
    sources = nextSources
    selectedId = nextSources.find((source) => source.isScreen)?.id ?? nextSources[0]?.id ?? null
    visible = true
    return new Promise((resolve) => {
      resolvePick = resolve
    })
  }

  const selectSource = (sourceId: string): void => {
    selectedId = sourceId
  }

  const shareSource = (sourceId: string): void => {
    finish(sourceId)
  }

  window.addEventListener('keydown', onKeyDown)
  onDestroy(() => {
    window.removeEventListener('keydown', onKeyDown)
    if (resolvePick) finish(null)
  })
</script>

<dialog class="modal" class:modal-open={visible}>
  <div class="modal-box max-w-3xl">
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-bold">{L.share_your_screen()}</h3>
      <button class="btn btn-sm btn-circle btn-ghost" aria-label={L.cancel()} onclick={() => finish(null)}>
        ✕
      </button>
    </div>
    {#if sources.length === 0}
      <p>{L.no_screens_found()}</p>
    {:else}
      {#if screens.length}
        <h2 class="font-semibold mb-3">{L.screens()}</h2>
        <div class="screen-picker-grid mb-5">
          {#each screens as source (source.id)}
            <button
              type="button"
              class="screen-picker-item {selectedId === source.id ? 'is-selected' : ''}"
              onclick={() => selectSource(source.id)}
              ondblclick={() => shareSource(source.id)}
            >
              <span class="screen-picker-thumb">
                {#if source.thumbnail}
                  <img src={source.thumbnail} alt={source.name} />
                {:else}
                  <i class="fa-solid fa-display"></i>
                {/if}
              </span>
              <span class="screen-picker-name">{source.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if windows.length}
        <h2 class="font-semibold mb-3">{L.windows()}</h2>
        <div class="screen-picker-grid">
          {#each windows as source (source.id)}
            <button
              type="button"
              class="screen-picker-item {selectedId === source.id ? 'is-selected' : ''}"
              onclick={() => selectSource(source.id)}
              ondblclick={() => shareSource(source.id)}
            >
              <span class="screen-picker-thumb">
                {#if source.thumbnail}
                  <img src={source.thumbnail} alt={source.name} />
                {:else}
                  <i class="fa-solid fa-window-maximize"></i>
                {/if}
                {#if source.appIcon}
                  <img class="screen-picker-app-icon" src={source.appIcon} alt="" />
                {/if}
              </span>
              <span class="screen-picker-name">{source.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
    <div class="modal-action">
      <button class="btn btn-primary" disabled={!selectedId} onclick={() => finish(selectedId)}>
        {L.share()}
      </button>
      <button class="btn" onclick={() => finish(null)}>{L.cancel()}</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={() => finish(null)}>close</button>
  </form>
</dialog>

<style>
  .screen-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 0.75rem;
  }

  .screen-picker-item {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 2px solid var(--color-base-300, #d1d5db);
    border-radius: 8px;
    background: var(--color-base-100, #fff);
    cursor: pointer;
    text-align: left;
    color: inherit;
  }

  .screen-picker-item.is-selected {
    border-color: var(--color-primary, #84cc16);
    box-shadow: 0 0 0 1px var(--color-primary, #84cc16);
  }

  .screen-picker-thumb {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 4px;
    background: var(--color-base-200, #f5f5f5);
    color: var(--color-base-content, #7a7a7a);
    font-size: 1.5rem;
  }

  .screen-picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .screen-picker-app-icon {
    position: absolute;
    left: 0.35rem;
    bottom: 0.35rem;
    width: 20px !important;
    height: 20px !important;
    object-fit: contain !important;
  }

  .screen-picker-name {
    font-size: 0.8rem;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
