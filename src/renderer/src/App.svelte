<script lang="ts">
  import Navigation from './Navigation.svelte'
  import Join from './Join.svelte'
  import Host from './Host.svelte'
  import Settings from './Settings.svelte'
  import About from './About.svelte'
  import Debug from './Debug.svelte'
  import Bonjour from './Bonjour.svelte'
  import ScreenPicker from './ScreenPicker.svelte'
  import Toast from './Toast.svelte'
  import SessionStage from './SessionStage.svelte'
  import IncomingCallNotice from './IncomingCallNotice.svelte'
  import { appState } from './appState.svelte'
  import { debugLog } from './debugLog.svelte'
  import { getDataFromKiwiUrl } from './Utils'
  import { sessionRoom as room } from './session/sessionStore.svelte'
  import { L } from './translations'
  import { onMount } from 'svelte'

  let screenPicker: ScreenPicker | undefined = $state()
  let closedDrawerForCall = false

  const presenting = $derived(Boolean(room.isLive || room.sessionEndedReason))
  const showInvite = $derived(
    appState.sessionSource !== 'bonjour' &&
      (appState.sessionSource === 'host' || room.isCoordinator),
  )
  const stageTitle = $derived(appState.isHosting ? L.hosting_a_session() : L.joined_a_session())

  $effect(() => {
    const liveBonjour = appState.sessionSource === 'bonjour' && room.isLive
    if (liveBonjour && !closedDrawerForCall) {
      closedDrawerForCall = true
      appState.bonjourVisible = false
    }
    if (!room.isLive || appState.sessionSource !== 'bonjour') closedDrawerForCall = false
  })

  onMount(async () => {
    window.KiwiApi.onSelectScreenShareSource((sources) =>
      screenPicker ? screenPicker.pick(sources) : Promise.resolve(null),
    )
    const settings = await window.KiwiApi.getSettings()
    appState.debugLogsEnabled = settings.debugLogsEnabled
    appState.bonjourEnabled = settings.bonjourEnabled === true
    debugLog.setEnabled(settings.debugLogsEnabled)
    if (settings.debugLogsEnabled) debugLog.info('app', 'debug logs enabled')
  })

  window.onmessage = async (evt: MessageEvent): Promise<void> => {
    const { data } = evt
    if (data.type !== 'openKiwiURL') return
    const urlData = await getDataFromKiwiUrl(data.url)
    switch (urlData.type) {
      case 'host':
        appState.activeView = 'join'
        appState.participantUrl = data.url
        break
      case 'participant':
        if (!appState.isCoordinator) return
        appState.hostUrl = data.url
        break
    }
  }
</script>

<div class="drawer drawer-end">
  <input id="bonjour-drawer" type="checkbox" onchange={(evt)=>{
    appState.bonjourVisible = (evt.target as HTMLInputElement).checked
    }} class="drawer-toggle" checked={appState.bonjourVisible ? true : false} />
  <div class="drawer-content">
    <Navigation />
    <Toast />
    <div class={presenting ? 'hidden' : ''}>
      {#if appState.activeView === 'join'}
        <Join />
      {:else if appState.activeView === 'host'}
        <Host />
      {:else if appState.activeView === 'settings'}
        <Settings />
      {:else if appState.activeView === 'about'}
        <About />
      {:else if appState.activeView === 'debug'}
        <Debug />
      {/if}
    </div>
    {#if presenting}
      <div class="container mx-auto p-5">
        <h1 class="text-3xl font-bold mb-4">{stageTitle}</h1>
        <SessionStage {room} {showInvite} onReset={() => appState.resetSession()} />
      </div>
    {/if}
  </div>
  <div class="drawer-side">
    <label for="bonjour-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
    <div class="menu bg-base-200 min-h-full w-120 p-4">
      {#if appState.bonjourEnabled}
        <Bonjour />
      {/if}
    </div>
  </div>
</div>

<IncomingCallNotice />
<ScreenPicker bind:this={screenPicker} />
