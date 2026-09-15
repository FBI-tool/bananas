<script lang="ts">
  import Navigation from './Navigation.svelte'
  import Join from './Join.svelte'
  import Host from './Host.svelte'
  import Settings from './Settings.svelte'
  import About from './About.svelte'
  import Debug from './Debug.svelte'
  import ScreenPicker from './ScreenPicker.svelte'
  import Toast from './Toast.svelte'
  import { appState } from './appState.svelte'
  import { debugLog } from './debugLog.svelte'
  import { getDataFromKiwiUrl } from './Utils'
  import { onMount } from 'svelte'

  let screenPicker: ScreenPicker | undefined = $state()

  onMount(async () => {
    window.KiwiApi.onSelectScreenShareSource((sources) =>
      screenPicker ? screenPicker.pick(sources) : Promise.resolve(null),
    )
    const settings = await window.KiwiApi.getSettings()
    appState.debugLogsEnabled = settings.debugLogsEnabled
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

<Navigation />
<Toast />

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

<ScreenPicker bind:this={screenPicker} />
