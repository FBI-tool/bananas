<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import {
    makeVideoDraggable,
    mayBeConnectionString,
    getDataFromKiwiUrl,
    ConnectionType,
    getUUIDv4
  } from './Utils'
  import { appState } from './appState.svelte'
  import { toast } from './toast.svelte'
  import { WebRTCSession } from './webrtc.svelte'
  import AudioVisualizer from './AudioVisualizer.svelte'

  const webrtc = new WebRTCSession()
  const UUID = getUUIDv4()

  let remoteScreen: HTMLVideoElement | undefined = $state()
  let zoomFactor = $state(1)
  let microphoneActive = $state(false)
  let isStreaming = $state(false)
  let isConnected = $state(false)
  let connectionStringIsValid = $state<boolean | null>(null)
  let connectToUserName = $state('')
  let copyButtonIsLoading = $state(false)
  let visualizerIsActive = $state(true)
  let username = $state('')
  let color = $state('#ffffff')

  $effect(() => {
    const value = appState.participantUrl
    void (async (): Promise<void> => {
      if (value === '') {
        connectionStringIsValid = null
        return
      }
      const valid = mayBeConnectionString(ConnectionType.HOST, value)
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

  const onConnectClick = async (): Promise<void> => {
    await webrtc.Setup(remoteScreen)
    const data = await getDataFromKiwiUrl(appState.participantUrl)
    await webrtc.Connect(data.rtcSessionDescription)
    isConnected = true
    appState.isWatching = true
    appState.navigationEnabled = false
  }

  const onCopyClick = async (): Promise<void> => {
    copyButtonIsLoading = true
    const remoteData = await getDataFromKiwiUrl(appState.participantUrl)
    const data = await webrtc.CreateParticipantUrl(remoteData.rtcSessionDescription, {
      username
    })
    navigator.clipboard.writeText(data)
    setTimeout(() => {
      copyButtonIsLoading = false
    }, 400)
  }

  onMount(async () => {
    const settings = await window.KiwiApi.getSettings()
    microphoneActive = settings.isMicrophoneEnabledOnConnect
    username = settings.username
    color = settings.color
    if (remoteScreen) makeVideoDraggable(remoteScreen)
  })

  const onRemoteScreenDblClick = (): void => {
    webrtc.PingRemoteCursor('cursor-' + UUID)
  }

  const onRemoteScreenMouseMove = (e: MouseEvent): void => {
    if (!remoteScreen) return
    const { offsetX, offsetY } = e
    webrtc.UpdateRemoteCursor({
      x: offsetX / remoteScreen.clientWidth,
      y: offsetY / remoteScreen.clientHeight,
      name: username,
      id: 'cursor-' + UUID,
      color
    })
  }

  const onRemoteScreenPlay = (): void => {
    if (!webrtc.IsConnected()) return
    isStreaming = true
  }

  const reset = (): void => {
    appState.participantUrl = ''
    connectionStringIsValid = null
    isStreaming = false
    microphoneActive = false
    isConnected = false
    appState.navigationEnabled = true
    appState.isWatching = false
  }

  const onDisconnectClick = async (): Promise<void> => {
    await webrtc.Disconnect()
    reset()
  }

  const onFullscreenClick = (): void => {
    remoteScreen?.requestFullscreen()
  }

  const onZoomInClick = (): void => {
    if (!remoteScreen) return
    zoomFactor += 0.1
    remoteScreen.style.scale = zoomFactor.toString()
  }

  const onZoomOutClick = (): void => {
    if (!remoteScreen) return
    if (zoomFactor <= 1) return
    zoomFactor -= 0.1
    remoteScreen.style.scale = zoomFactor.toString()
  }

  const onMicrophoneToggle = async (): Promise<void> => {
    microphoneActive = !microphoneActive
    webrtc.ToggleMicrophone()
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
  <h1 class="text-3xl font-bold mb-4">{!isStreaming ? L.join_a_session() : L.joined_a_session()}</h1>
  {#if isStreaming}
    <div class="flex justify-between items-center mb-4">
      <button
        aria-label={microphoneActive ? L.microphone_active() : L.microphone_inactive()}
        title={microphoneActive ? L.microphone_active() : L.microphone_inactive()}
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
      <button class="btn btn-error" aria-label={L.disconnect()} onclick={onDisconnectClick}>
        <span class="icon">
          <i class="fas fa-unlink"></i>
        </span>
        <span>{L.disconnect()}</span>
      </button>
    </div>
  {/if}

  {#if !isStreaming && !isConnected}
    <div class="join w-full mb-4">
      <label class="input join-item flex-1 {connectionInputClass}">
        <i class="fas fa-user"></i>
        <input
          bind:value={appState.participantUrl}
          placeholder={L.host_connection_string()}
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

  {#if isConnected && !isStreaming}
    <div class="flex gap-2 mb-4">
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
      <button class="btn btn-error" onclick={onDisconnectClick}>
        <span class="icon">
          <i class="fas fa-unlink"></i>
        </span>
        <span>{L.cancel()}</span>
      </button>
    </div>
  {/if}
</div>

<div class={isStreaming ? '' : 'hidden'}>
  <fieldset class="fieldset px-5">
    <legend class="fieldset-legend">{L.remote_screen()}</legend>
    <div class="video-overflow">
      <video
        bind:this={remoteScreen}
        id="remote_screen"
        class="video"
        autoplay
        playsinline
        muted
        ondblclick={onRemoteScreenDblClick}
        onmousemove={onRemoteScreenMouseMove}
        onplay={onRemoteScreenPlay}
      ></video>
    </div>
  </fieldset>
  <div class="flex gap-2 px-5 pb-5">
    <button class="btn btn-info" onclick={onZoomInClick}>
      <span class="icon">
        <i class="fas fa-search-plus"></i>
      </span>
      <span>{L.zoom_in()}</span>
    </button>
    <button class="btn btn-info" onclick={onZoomOutClick}>
      <span class="icon">
        <i class="fas fa-search-minus"></i>
      </span>
      <span>{L.zoom_out()}</span>
    </button>
    <button class="btn btn-info" onclick={onFullscreenClick}>
      <span class="icon">
        <i class="fas fa-expand"></i>
      </span>
      <span>{L.fullscreen()}</span>
    </button>
  </div>
</div>

<style>
  .video {
    width: 100%;
    height: auto;
    transition: transform 0.5s linear;
  }
  .video-overflow {
    width: 100%;
    height: auto;
    overflow: hidden;
  }
</style>
