<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import { appState } from './appState.svelte'
  import { toast } from './toastState.svelte'
  import { mayBeConnectionString, getDataFromKiwiUrl, ConnectionType } from './Utils'
  import AudioVisualizer from './AudioVisualizer.svelte'
  import { WebRTCSession } from './webrtc.svelte'

  const webrtc = new WebRTCSession()

  let cursorsActive = $state(false)
  let displayStreamActive = $state(false)
  let microphoneActive = $state(false)
  let isStreaming = $state(false)
  let sessionStarted = $state(false)
  let connectionStringIsValid = $state<boolean | null>(null)
  let connectToUserName = $state('')
  let copyButtonIsLoading = $state(false)
  let hasAudioInput = $state(false)
  let visualizerIsActive = $state(true)
  let startingSession = $state(false)
  let username = $state('')

  $effect(() => {
    const value = appState.hostUrl
    void (async (): Promise<void> => {
      if (value === '') {
        connectionStringIsValid = null
        return
      }
      const valid = mayBeConnectionString(ConnectionType.PARTICIPANT, value)
      connectionStringIsValid = valid
      if (valid) {
        const kiwiData = await getDataFromKiwiUrl(value)
        connectToUserName = kiwiData.data.username
      }
    })()
  })

  $effect(() => {
    switch (webrtc.connectionState) {
      case 'connected':
        toast.show('success', L.connection_established())
        break
      case 'failed':
        toast.show('error', 'Connection failed')
        break
      case 'closed':
        toast.show('info', 'Connection closed')
        break
      default:
        break
    }
  })

  const toggleRemoteCursors = (): void => {
    cursorsActive = !cursorsActive
    window.KiwiApi.toggleRemoteCursors(cursorsActive)
    webrtc.ToggleRemoteCursors(cursorsActive)
  }

  const onConnectClick = async (): Promise<void> => {
    const data = await getDataFromKiwiUrl(appState.hostUrl)
    await webrtc.Connect(data.rtcSessionDescription)
    isStreaming = true
    displayStreamActive = true
  }

  const onCopyClick = async (): Promise<void> => {
    copyButtonIsLoading = true
    const offer = await webrtc.CreateHostUrl({
      username
    })
    navigator.clipboard.writeText(offer)
    setTimeout(() => {
      copyButtonIsLoading = false
    }, 400)
  }

  onMount(async () => {
    const settings = await window.KiwiApi.getSettings()
    microphoneActive = settings.isMicrophoneEnabledOnConnect
    username = settings.username
  })

  const onStartSessionButtonClick = async (): Promise<void> => {
    if (startingSession) return
    startingSession = true
    try {
      const setupResult = await webrtc.Setup()
      if (setupResult === 'cancelled') return
      if (setupResult !== 'ok') {
        toast.show('error', L.screen_share_failed(), 2500)
        return
      }
      sessionStarted = true
      appState.navigationEnabled = false
      appState.isHosting = true
      hasAudioInput = webrtc.HasAudioInput()
    } finally {
      startingSession = false
    }
  }

  const reset = (): void => {
    appState.hostUrl = ''
    cursorsActive = false
    displayStreamActive = false
    microphoneActive = true
    isStreaming = false
    sessionStarted = false
    connectionStringIsValid = null
    copyButtonIsLoading = false
    appState.navigationEnabled = true
    appState.isHosting = false
  }

  const onDisconnectClick = async (): Promise<void> => {
    await webrtc.Disconnect()
    reset()
  }

  const onMicrophoneToggle = async (): Promise<void> => {
    microphoneActive = !microphoneActive
    webrtc.ToggleMicrophone()
  }

  const onDisplayStreamToggle = async (): Promise<void> => {
    displayStreamActive = !displayStreamActive
    webrtc.ToggleDisplayStream()
    if (!displayStreamActive) {
      cursorsActive = false
      window.KiwiApi.toggleRemoteCursors(cursorsActive)
      webrtc.ToggleRemoteCursors(cursorsActive)
    }
  }

  const connectionInputClass = $derived(
    connectionStringIsValid === null
      ? ''
      : connectionStringIsValid
        ? 'input-success'
        : 'input-error'
  )
  const connectButtonClass = $derived(
    connectionStringIsValid === null
      ? 'btn-primary'
      : connectionStringIsValid
        ? 'btn-success'
        : 'btn-error'
  )
</script>

<div class="container mx-auto p-5">
  <h1 class="text-3xl font-bold mb-4">{!isStreaming ? L.host_a_session() : L.hosting_a_session()}</h1>
  {#if isStreaming}
    <div class="flex justify-between items-center mb-4">
      <div class="flex gap-2">
        <button
          title={L.streaming_your_display()}
          class="btn {displayStreamActive ? 'btn-success' : 'btn-error'}"
          onclick={onDisplayStreamToggle}
        >
          <span class="icon">
            <i class="fa-solid fa-display"></i>
          </span>
        </button>
        {#if hasAudioInput}
          <button
            title={microphoneActive ? 'Microphone active' : 'Microphone muted'}
            class="btn {microphoneActive ? 'btn-success' : 'btn-error'}"
            onclick={onMicrophoneToggle}
          >
            <span class="icon">
              {#if microphoneActive}
                <AudioVisualizer
                  className="icon {visualizerIsActive ? '' : 'hidden'}"
                  bind:visualizerIsActive
                  stream={webrtc.GetAudioStream()}
                />
                <i class="fas fa-microphone {visualizerIsActive ? 'hidden' : ''}"></i>
              {:else}
                <i class="fas fa-microphone-slash"></i>
              {/if}
            </span>
          </button>
        {/if}
        {#if displayStreamActive}
          <button
            title={cursorsActive ? L.remote_cursors_enabled() : L.remote_cursors_disabled()}
            class="btn {cursorsActive ? 'btn-success' : 'btn-error'}"
            onclick={toggleRemoteCursors}
          >
            <span class="icon">
              <i class="fas fa-mouse-pointer"></i>
            </span>
          </button>
        {/if}
      </div>
      <button class="btn btn-error" onclick={onDisconnectClick}>
        <span class="icon">
          <i class="fas fa-unlink"></i>
        </span>
        <span>{L.disconnect()}</span>
      </button>
    </div>
  {/if}
  <div class="flex flex-wrap gap-2 mb-4">
    {#if !isStreaming}
      <button
        class="btn btn-primary {startingSession ? 'pointer-events-none' : ''}"
        disabled={sessionStarted || startingSession}
        onclick={onStartSessionButtonClick}
      >
        {#if startingSession}
          <span class="loading loading-spinner"></span>
        {:else}
          <span class="icon">
            <i class="fas fa-play"></i>
          </span>
        {/if}
        <span>{!sessionStarted ? L.start_a_new_session() : L.session_started()}</span>
      </button>
    {/if}

    {#if sessionStarted && !isStreaming}
      <button class="btn btn-error" onclick={onDisconnectClick}>
        <span class="icon">
          <i class="fas fa-unlink"></i>
        </span>
        <span>{L.cancel()}</span>
      </button>
      <button
        class="btn btn-primary {copyButtonIsLoading ? 'pointer-events-none' : ''}"
        onclick={onCopyClick}
      >
        {#if copyButtonIsLoading}
          <span class="loading loading-spinner"></span>
        {:else}
          <span class="icon">
            <i class="fas fa-copy"></i>
          </span>
        {/if}
        <span>{L.copy_my_connection_string()}</span>
      </button>
    {/if}
  </div>

  {#if sessionStarted && !isStreaming}
    <div class="join w-full">
      <label class="input join-item flex-1 {connectionInputClass}">
        <i class="fas fa-user"></i>
        <input
          bind:value={appState.hostUrl}
          placeholder="participant connection string"
          type="text"
        />
        <i
          class="fas {connectionStringIsValid === null
            ? 'fa-question'
            : connectionStringIsValid
              ? 'fa-check'
              : 'fa-times'}"
        ></i>
      </label>
      <button
        class="btn join-item {connectButtonClass}"
        onclick={onConnectClick}
        disabled={!connectionStringIsValid}
      >
        <span class="icon">
          <i class="fas fa-link"></i>
        </span>
        <span>{L.connect()} {connectionStringIsValid ? connectToUserName : ''}</span>
      </button>
    </div>
  {/if}
</div>
