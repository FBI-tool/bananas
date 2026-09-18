<script lang="ts">
  import { appState } from './appState.svelte'
  import { L } from './translations'
  import type { ViewName } from './types'

  const handleTopButtonsClick = (evt: MouseEvent): void => {
    evt.preventDefault()
    const target = evt.target as HTMLButtonElement
    const root = target.closest('button')
    const action = root?.dataset.action as ViewName | undefined
    if (action) appState.activeView = action
  }
</script>

<div class="navbar bg-base-100 px-4">
  <div class="flex flex-wrap gap-2">
    <button
      class="btn {appState.activeView === 'join' ? 'btn-primary' : 'btn-ghost'}"
      data-action="join"
      onclick={handleTopButtonsClick}
      disabled={!appState.navigationEnabled}
    >
      <span class="icon">
        <i class="fa-solid fa-right-to-bracket"></i>
      </span>
      <strong>{!appState.isWatching ? L.join_a_session() : L.joined_a_session()}</strong>
    </button>
    <button
      class="btn {appState.activeView === 'host' ? 'btn-primary' : 'btn-ghost'}"
      data-action="host"
      onclick={handleTopButtonsClick}
      disabled={!appState.navigationEnabled}
    >
      <span class="icon">
        <i class="fa-solid fa-earth-africa"></i>
      </span>
      <strong>{!appState.isHosting ? L.host_a_session() : L.hosting_a_session()}</strong>
    </button>
    <button
      class="btn {appState.activeView === 'settings' ? 'btn-primary' : 'btn-ghost'}"
      data-action="settings"
      onclick={handleTopButtonsClick}
      disabled={!appState.navigationEnabled}
    >
      <span class="icon">
        <i class="fa-solid fa-gear"></i>
      </span>
      <strong>{L.settings()}</strong>
    </button>
    <button
      class="btn {appState.activeView === 'about' ? 'btn-primary' : 'btn-ghost'}"
      data-action="about"
      onclick={handleTopButtonsClick}
      disabled={!appState.navigationEnabled}
    >
      <span class="icon">
        <i class="fa-solid fa-question"></i>
      </span>
      <strong>{L.about()}</strong>
    </button>
    {#if appState.debugLogsEnabled}
      <button
        class="btn {appState.activeView === 'debug' ? 'btn-primary' : 'btn-ghost'}"
        data-action="debug"
        onclick={handleTopButtonsClick}
      >
        <span class="icon">
          <i class="fa-solid fa-bug"></i>
        </span>
        <strong>{L.debug()}</strong>
      </button>
    {/if}
  </div>
  <div class="navbar-end">
    {#if appState.bonjourEnabled}
      <button
        class="btn {appState.bonjourVisible === true ? 'btn-active' : 'btn-ghost'}"
        aria-label={L.bonjour()}
        onclick={()=> (appState.bonjourVisible = !appState.bonjourVisible)}
      >
        <span class="tooltip tooltip-left" data-tip={L.bonjour()}>
          <span class="icon">
            <i class="fa-solid fa-address-book"></i>
          </span>
        </span>
      </button>
    {/if}
  </div>
</div>
