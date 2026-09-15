<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import { appState } from './appState.svelte'
  import { toast } from './toastState.svelte'
  import {
    ConnectionType,
    getDataFromKiwiUrl,
    getUUIDv4,
    makeVideoDraggable,
    mayBeConnectionString
  } from './Utils'
  import AudioVisualizer from './AudioVisualizer.svelte'
  import SessionEndedOverlay from './SessionEndedOverlay.svelte'
  import PresenterVoteModal from './PresenterVoteModal.svelte'
  import type { Room } from './session/room.svelte'

  let {
    room,
    remoteScreen = $bindable(),
    showInvite = false,
    onReset
  }: {
    room: Room
    remoteScreen?: HTMLVideoElement
    showInvite?: boolean
    onReset: () => void
  } = $props()

  const UUID = getUUIDv4()
  let zoomFactor = $state(1)
  let visualizerIsActive = $state(true)
  let connectionStringIsValid = $state<boolean | null>(null)
  let connectToUserName = $state('')
  let username = $state('')
  let color = $state('#ffffff')
  let overlayAutoOpened = false
  let inviteInFlight = false

  const showVideo = $derived(!room.isPresenter || Boolean(room.sessionEndedReason))
  const videoClass = $derived(room.sessionEndedReason ? 'video video-ended' : 'video')

  $effect(() => {
    if (remoteScreen) {
      room.setRemoteVideo(remoteScreen)
      makeVideoDraggable(remoteScreen)
    }
  })

  $effect(() => {
    const value = appState.hostUrl
    void (async (): Promise<void> => {
      if (!showInvite || value === '') {
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
    if (room.isLive && !overlayAutoOpened) {
      overlayAutoOpened = true
      void window.KiwiApi.toggleCallOverlay(true)
    }
    if (!room.isLive) overlayAutoOpened = false
  })

  $effect(() => {
    const kind = room.voteRejectedKind
    if (!kind) return
    room.clearVoteRejected()
    toast.show('info', kind === 'kick' ? L.vote_remove_rejected() : L.vote_rejected())
  })

  onMount(async () => {
    const settings = await window.KiwiApi.getSettings()
    username = settings.username
    color = settings.color
  })

  const onMicrophoneToggle = (): void => {
    room.ToggleMicrophone()
  }

  const onCameraToggle = async (): Promise<void> => {
    await room.ToggleCamera()
    void window.KiwiApi.toggleCallOverlay(true)
  }

  const onChatClick = (): void => {
    void window.KiwiApi.toggleCallOverlay(true)
  }

  const onDisplayStreamToggle = (): void => {
    room.ToggleDisplayStream()
  }

  const toggleRemoteCursors = (): void => {
    const next = !room.cursorsEnabled
    room.ToggleRemoteCursors(next)
  }

  const onLeaveClick = async (): Promise<void> => {
    await room.leave()
    onReset()
  }

  const onEndSessionClick = async (): Promise<void> => {
    await room.endSession()
    onReset()
  }

  const onRequestPresent = async (): Promise<void> => {
    const result = await room.requestToPresent()
    if (result === 'cooldown') toast.show('info', L.vote_cooldown())
    if (result === 'blocked') toast.show('info', L.vote_rejected())
    if (result === 'failed') toast.show('error', L.screen_share_failed(), 2500)
  }

  const onRequestKick = async (peerId: string): Promise<void> => {
    const result = await room.requestKick(peerId)
    if (result === 'cooldown') toast.show('info', L.vote_remove_cooldown())
    if (result === 'blocked') toast.show('info', L.vote_remove_rejected())
  }

  const onChangeScreen = async (): Promise<void> => {
    const result = await room.changeScreen()
    if (result === 'failed') toast.show('error', L.screen_share_failed(), 2500)
  }

  const onCopyInvite = async (): Promise<void> => {
    if (inviteInFlight) return
    inviteInFlight = true
    try {
      const offer = await room.CreateHostUrl({ username })
      if (!offer) {
        toast.show('error', L.room_is_full())
      } else {
        void navigator.clipboard.writeText(offer)
      }
    } catch (error) {
      console.error(error)
      toast.show('error', L.connection_failed())
    } finally {
      inviteInFlight = false
    }
  }

  const onConnectInvite = async (): Promise<void> => {
    try {
      const data = await getDataFromKiwiUrl(appState.hostUrl)
      await room.Connect(data.rtcSessionDescription)
      appState.hostUrl = ''
    } catch (error) {
      console.error(error)
      toast.show('error', L.connection_failed())
    }
  }

  const onRemoteScreenDblClick = (): void => {
    room.PingRemoteCursor('cursor-' + UUID)
  }

  const onRemoteScreenMouseMove = (e: MouseEvent): void => {
    if (!remoteScreen || room.isPresenter) return
    const { offsetX, offsetY } = e
    room.UpdateRemoteCursor({
      x: offsetX / remoteScreen.clientWidth,
      y: offsetY / remoteScreen.clientHeight,
      name: username,
      id: 'cursor-' + UUID,
      color
    })
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

  const connectionInputClass = $derived(
    connectionStringIsValid === null ? '' : connectionStringIsValid ? 'input-success' : 'input-error'
  )
  const connectButtonClass = $derived(
    connectionStringIsValid === null
      ? 'btn-primary'
      : connectionStringIsValid
        ? 'btn-success'
        : 'btn-error'
  )
</script>

<div class="flex justify-between items-center mb-4 gap-2 flex-wrap">
  <div class="flex gap-2 flex-wrap">
    {#if room.isPresenter}
      <button
        title={L.streaming_your_display()}
        class="btn {room.displayStreamActive ? 'btn-success' : 'btn-error'}"
        onclick={onDisplayStreamToggle}
      >
        <span class="icon">
          <i class="fa-solid fa-display"></i>
        </span>
      </button>
      <button class="btn btn-info" onclick={onChangeScreen}>
        <span class="icon">
          <i class="fa-solid fa-display"></i>
        </span>
        <span>{L.change_screen()}</span>
      </button>
      {#if room.displayStreamActive}
        <button
          title={room.cursorsEnabled ? L.remote_cursors_enabled() : L.remote_cursors_disabled()}
          class="btn {room.cursorsEnabled ? 'btn-success' : 'btn-error'}"
          onclick={toggleRemoteCursors}
        >
          <span class="icon">
            <i class="fas fa-mouse-pointer"></i>
          </span>
        </button>
      {/if}
    {:else}
      <button class="btn btn-primary" onclick={onRequestPresent} disabled={Boolean(room.activeVote)}>
        <span>{L.request_to_present()}</span>
      </button>
    {/if}
    {#if room.hasAudioInput}
      <button
        aria-label={room.microphoneActive ? L.microphone_active() : L.microphone_inactive()}
        title={room.microphoneActive ? L.microphone_active() : L.microphone_inactive()}
        class="btn {room.microphoneActive ? 'btn-success' : 'btn-error'}"
        onclick={onMicrophoneToggle}
      >
        <span class="icon mic-btn-icon">
          {#if room.microphoneActive}
            <AudioVisualizer
              className={visualizerIsActive ? '' : 'hidden'}
              bind:visualizerIsActive
              stream={room.GetAudioStream()}
            />
            <i class="fas fa-microphone {visualizerIsActive ? 'hidden' : ''}"></i>
          {:else}
            <i class="fas fa-microphone-slash"></i>
          {/if}
        </span>
      </button>
    {/if}
    <button
      aria-label={room.cameraActive ? L.camera_on() : L.camera_off()}
      title={room.cameraActive ? L.camera_on() : L.camera_off()}
      class="btn {room.cameraActive ? 'btn-success' : 'btn-error'}"
      onclick={onCameraToggle}
    >
      <span class="icon">
        <i class="fa-solid {room.cameraActive ? 'fa-video' : 'fa-video-slash'}"></i>
      </span>
    </button>
    <button class="btn btn-info" onclick={onChatClick}>
      <span class="icon">
        <i class="fa-solid fa-comment"></i>
      </span>
      <span>{L.chat()}</span>
    </button>
  </div>
  <div class="flex gap-2">
    <button class="btn btn-error" onclick={onLeaveClick}>
      <span class="icon">
        <i class="fas fa-unlink"></i>
      </span>
      <span>{L.leave()}</span>
    </button>
    {#if room.isCoordinator}
      <button class="btn btn-error" onclick={onEndSessionClick}>
        <span>{L.end_session()}</span>
      </button>
    {/if}
  </div>
</div>

{#if room.presenterGone && !room.isPresenter && !room.sessionEndedReason}
  <div class="alert alert-warning mb-4">{L.presenter_left()}</div>
{/if}

<div class="mb-4">
  <h2 class="font-semibold mb-2">{L.peer_list()}</h2>
  <ul class="flex flex-wrap gap-2">
    {#each room.peers as peer (peer.id)}
      <li class="badge badge-lg gap-1">
        {peer.username}{peer.id === room.localPeerId ? ` (${L.you()})` : ''}
        {#if peer.id === room.coordinatorId}
          · {L.coordinator()}
        {/if}
        {#if peer.id === room.presenterId}
          · {L.presenter()}
        {/if}
        {#if peer.id !== room.localPeerId}
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle"
            aria-label={L.remove_from_session()}
            title={L.remove_from_session()}
            disabled={Boolean(room.activeVote) || !room.canRequestKick(peer.id)}
            onclick={() => onRequestKick(peer.id)}
          >
            <span class="icon">
              <i class="fa-solid fa-user-minus"></i>
            </span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</div>

{#if showInvite && room.isCoordinator}
  <div class="flex flex-wrap gap-2 mb-4">
    <button class="btn btn-primary" onclick={onCopyInvite}>
      <span class="icon">
        <i class="fas fa-copy"></i>
      </span>
      <span>{L.invite_another()}</span>
    </button>
  </div>
  <div class="join w-full mb-4">
    <label class="input join-item flex-1 {connectionInputClass}">
      <i class="fas fa-user"></i>
      <input
        bind:value={appState.hostUrl}
        placeholder={L.participant_connection_string()}
        type="text"
      />
    </label>
    <button
      class="btn join-item {connectButtonClass}"
      onclick={onConnectInvite}
      disabled={!connectionStringIsValid}
    >
      <span>{L.connect()} {connectionStringIsValid ? connectToUserName : ''}</span>
    </button>
  </div>
{/if}

<div class={showVideo ? 'relative' : 'hidden'}>
  <fieldset class="fieldset px-0">
    <legend class="fieldset-legend">{L.remote_screen()}</legend>
    <div class="video-overflow relative">
      <video
        bind:this={remoteScreen}
        id="remote_screen"
        class={videoClass}
        autoplay
        playsinline
        muted
        ondblclick={onRemoteScreenDblClick}
        onmousemove={onRemoteScreenMouseMove}
      ></video>
      <SessionEndedOverlay
        reason={room.sessionEndedReason}
        onDismiss={() => {
          room.dismissSessionEnded()
          onReset()
        }}
      />
    </div>
  </fieldset>
  <div class="flex gap-2 pb-5">
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

<PresenterVoteModal {room} />

<style>
  .video {
    width: 100%;
    height: auto;
    transition:
      transform 0.5s linear,
      filter 0.3s ease,
      opacity 0.3s ease;
  }
  .video-ended {
    opacity: 0.5;
    filter: grayscale(1) saturate(0.5);
  }
  .video-overflow {
    width: 100%;
    height: auto;
    overflow: hidden;
  }
  .mic-btn-icon {
    width: 1.25rem;
    height: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
</style>
