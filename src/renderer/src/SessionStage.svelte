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
  const localGrant = $derived(room.localRemoteGrant)
  const controlling = $derived(Boolean(localGrant && (localGrant.mouse || localGrant.keyboard)))

  let pendingMove = $state<{ x: number; y: number } | null>(null)
  let moveFrame = 0
  let captureFocus = $state(false)
  let videoStage: HTMLDivElement | undefined = $state()

  const contentPoint = (e: MouseEvent): { x: number; y: number } | null => {
    if (!remoteScreen) return null
    const rect = remoteScreen.getBoundingClientRect()
    const videoW = remoteScreen.videoWidth || rect.width
    const videoH = remoteScreen.videoHeight || rect.height
    if (!videoW || !videoH) return null
    const scale = Math.min(rect.width / videoW, rect.height / videoH)
    const contentW = videoW * scale
    const contentH = videoH * scale
    const offsetX = (rect.width - contentW) / 2
    const offsetY = (rect.height - contentH) / 2
    const x = (e.clientX - rect.left - offsetX) / contentW
    const y = (e.clientY - rect.top - offsetY) / contentH
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }

  const flushMove = (): void => {
    moveFrame = 0
    if (!pendingMove || !localGrant?.mouse) return
    room.sendRemotePointerMove(pendingMove.x, pendingMove.y)
    pendingMove = null
  }

  const queueMove = (e: MouseEvent): void => {
    if (!localGrant?.mouse) {
      onRemoteScreenMouseMove(e)
      return
    }
    const point = contentPoint(e)
    if (!point) return
    pendingMove = point
    if (!moveFrame) moveFrame = requestAnimationFrame(flushMove)
  }

  const buttonName = (button: number): 'left' | 'middle' | 'right' | 'back' | 'forward' | null => {
    if (button === 0) return 'left'
    if (button === 1) return 'middle'
    if (button === 2) return 'right'
    if (button === 3) return 'back'
    if (button === 4) return 'forward'
    return null
  }

  const videoIsFullscreen = (): boolean =>
    Boolean(videoStage && document.fullscreenElement === videoStage)

  const typingInPageField = (e: KeyboardEvent): boolean => {
    const target = e.target
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  }

  const onRemotePointerDown = (e: PointerEvent): void => {
    if (!localGrant?.mouse && !localGrant?.keyboard) return
    captureFocus = true
    if (!localGrant?.mouse) return
    const name = buttonName(e.button)
    if (!name) return
    e.preventDefault()
    room.sendRemotePointerButton(name, 'down')
  }

  const onRemotePointerUp = (e: PointerEvent): void => {
    if (!localGrant?.mouse) return
    const name = buttonName(e.button)
    if (!name) return
    e.preventDefault()
    room.sendRemotePointerButton(name, 'up')
  }

  const onRemoteWheel = (e: WheelEvent): void => {
    if (!localGrant?.mouse) return
    e.preventDefault()
    room.sendRemoteWheel(e.deltaX, e.deltaY)
  }

  const onRemoteContextMenu = (e: MouseEvent): void => {
    if (localGrant?.mouse) e.preventDefault()
  }

  const onWindowKey = (e: KeyboardEvent, action: 'down' | 'up'): void => {
    const fullscreen = videoIsFullscreen()
    if (fullscreen && e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    if (!localGrant?.keyboard) return
    if (!fullscreen && !captureFocus) return
    if (!fullscreen && typingInPageField(e)) return
    forwardRemoteKey({
      action,
      code: e.code,
      location: e.location,
      repeat: e.repeat,
      modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
    })
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  const forwardRemoteKey = (event: {
    action: 'down' | 'up'
    code: string
    location?: number
    repeat?: boolean
    modifiers?: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
  }): void => {
    room.sendRemoteKey(event)
  }

  const fieldIsFocused = (): boolean => {
    const target = document.activeElement
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  }

  $effect(() => {
    void remoteScreen
    void videoStage
    void captureFocus
    const keyboardGrant = Boolean(localGrant?.keyboard)
    if (!keyboardGrant) captureFocus = false
    const down = (e: KeyboardEvent): void => {
      const capturing = keyboardGrant && (videoIsFullscreen() || captureFocus) && !fieldIsFocused()
      if (capturing) {
        if (videoIsFullscreen() && e.key === 'Escape') {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
        return
      }
      onWindowKey(e, 'down')
    }
    const up = (e: KeyboardEvent): void => {
      const capturing = keyboardGrant && (videoIsFullscreen() || captureFocus) && !fieldIsFocused()
      if (capturing) return
      onWindowKey(e, 'up')
    }
    const syncCapture = (): void => {
      const fullscreen = videoIsFullscreen()
      if (fullscreen) captureFocus = true
      const capturing = keyboardGrant && (fullscreen || captureFocus) && !fieldIsFocused()
      void window.KiwiApi.remoteControl.setLocalCapture(capturing)
      if (fullscreen) {
        void (keyboardGrant ? navigator.keyboard?.lock() : navigator.keyboard?.lock(['Escape']))
      } else {
        navigator.keyboard?.unlock()
      }
    }
    const unsubLocalKey = window.KiwiApi.remoteControl.onLocalKey((event) => {
      if (!localGrant?.keyboard) return
      forwardRemoteKey(event)
    })
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    document.addEventListener('fullscreenchange', syncCapture)
    document.addEventListener('focusin', syncCapture)
    document.addEventListener('focusout', syncCapture)
    syncCapture()
    return (): void => {
      unsubLocalKey()
      void window.KiwiApi.remoteControl.setLocalCapture(false)
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      document.removeEventListener('fullscreenchange', syncCapture)
      document.removeEventListener('focusin', syncCapture)
      document.removeEventListener('focusout', syncCapture)
      navigator.keyboard?.unlock()
    }
  })

  $effect(() => {
    if (remoteScreen) {
      room.setRemoteVideo(remoteScreen)
      makeVideoDraggable(remoteScreen)
    }
  })

  $effect(() => {
    if (room.isLive && remoteScreen?.srcObject) {
      void remoteScreen.play?.().catch(() => undefined)
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
      await room.Connect(data.rtcSessionDescription, { invite: data.invite })
      appState.hostUrl = ''
    } catch (error) {
      console.error(error)
      toast.show('error', L.connection_failed())
    }
  }

  const onRemoteScreenDblClick = (): void => {
    room.PingRemoteCursor(room.localPeerId || 'cursor-' + UUID)
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

  const onFullscreenClick = async (): Promise<void> => {
    if (!videoStage) return
    if (document.fullscreenElement === videoStage) {
      await document.exitFullscreen()
      return
    }
    await videoStage.requestFullscreen()
    captureFocus = true
    if (localGrant?.keyboard) void navigator.keyboard?.lock()
    else void navigator.keyboard?.lock(['Escape'])
  }

  const onExitFullscreenClick = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    void document.exitFullscreen()
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
      <button
        class="btn {controlling ? 'btn-success' : 'btn-ghost'}"
        onclick={() => room.requestRemoteControl(true, true)}
        disabled={Boolean(room.localRemoteGrant)}
      >
        <span>{L.remote_control_request_button()}</span>
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

{#if room.identityChanged}
  <div class="alert alert-warning mb-4">{L.identity_changed()}</div>
{/if}

{#if room.emergencyStopMessage}
  <div class="alert alert-error mb-4">{L.remote_control_emergency()}</div>
{/if}

{#if controlling}
  <div class="alert alert-info mb-4">
    {L.remote_control_controlling({ name: room.presenterUsername() || L.presenter() })}
    {#if localGrant?.mouse}· {L.remote_control_mouse()}{/if}
    {#if localGrant?.keyboard}· {L.remote_control_keyboard()}{/if}
  </div>
{/if}

{#if room.isPresenter && room.activeRemoteController}
  {@const controller = room.peers.find((peer) => peer.id === room.activeRemoteController?.peerId)}
  <div class="alert alert-warning mb-4">
    <div>
      <p class="font-semibold">{L.remote_control_active()}</p>
      <p>
        {controller?.username ?? room.activeRemoteController.peerId.slice(0, 8)}:
        {#if room.activeRemoteController.mouse}{L.remote_control_mouse()}{/if}
        {#if room.activeRemoteController.mouse && room.activeRemoteController.keyboard} + {/if}
        {#if room.activeRemoteController.keyboard}{L.remote_control_keyboard()}{/if}
      </p>
      <p class="text-sm opacity-80">{L.remote_control_emergency_hotkey({ hotkey: room.emergencyHotkeyLabel })}</p>
    </div>
  </div>
{/if}

{#if room.isPresenter && room.remoteControlCaps && !room.remoteControlCaps.emergencyHotkey}
  <div class="alert alert-warning mb-4">
    <span>{L.remote_control_unavailable()}</span>
    {#if room.remoteControlCaps.unavailableReason === 'accessibility-permission'}
      <button class="btn btn-sm" onclick={() => room.requestRemoteControlPermission()}>
        {L.remote_control_request_permission()}
      </button>
    {/if}
  </div>
{/if}

{#each room.remoteControlRequests as request (request.peerId)}
  <div class="alert mb-4">
    <span>{L.remote_control_request({ name: request.username })}</span>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-sm" onclick={() => room.grantRemoteControl(request.peerId, { mouse: true, keyboard: false })}>
        {L.remote_control_allow_mouse()}
      </button>
      <button class="btn btn-sm" onclick={() => room.grantRemoteControl(request.peerId, { mouse: false, keyboard: true })}>
        {L.remote_control_allow_keyboard()}
      </button>
      <button class="btn btn-sm btn-primary" onclick={() => room.grantRemoteControl(request.peerId, { mouse: true, keyboard: true })}>
        {L.remote_control_allow_both()}
      </button>
      <button class="btn btn-sm btn-ghost" onclick={() => room.denyRemoteControlRequest(request.peerId)}>
        {L.remote_control_deny()}
      </button>
    </div>
  </div>
{/each}

<div class="mb-4">
  <h2 class="font-semibold mb-2">{L.e2ee_status()}</h2>
  {#if room.e2eeActive && room.mediaE2eeActive}
    <p class="badge badge-success">{L.e2ee_on()}</p>
  {:else if room.e2eeActive}
    <p class="badge badge-error">{L.e2ee_app_only()}</p>
  {:else}
    <p class="badge badge-ghost">{L.e2ee_off()}</p>
  {/if}
  {#if room.e2eeError}
    <p class="text-error text-sm mt-1">{room.e2eeError}</p>
  {/if}
  {#if room.verification}
    <div class="mt-2 text-sm">
      <p><span class="font-semibold">{L.verification_code()}:</span> {room.verification.securityCode}</p>
      <p class="opacity-70">{L.verification()}</p>
      <ul class="mt-1">
        {#each room.verification.members as member (member.peerId)}
          <li class="font-mono text-xs">
            {member.peerId === room.localPeerId ? L.you() : member.peerId.slice(0, 8)}
            · {member.fingerprint}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

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
        {#if room.remoteControl[peer.id]?.mouse || room.remoteControl[peer.id]?.keyboard}
          · {L.remote_control()}
        {/if}
        {#if room.isPresenter && peer.id !== room.localPeerId}
          <label class="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              checked={Boolean(room.remoteControl[peer.id]?.mouse)}
              onchange={(e) => {
                const mouse = e.currentTarget.checked
                const keyboard = Boolean(room.remoteControl[peer.id]?.keyboard)
                if (mouse || keyboard) void room.grantRemoteControl(peer.id, { mouse, keyboard })
                else void room.revokeRemoteControl(peer.id, 'host')
              }}
            />
            {L.remote_control_mouse()}
          </label>
          <label class="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              class="checkbox checkbox-xs"
              checked={Boolean(room.remoteControl[peer.id]?.keyboard)}
              onchange={(e) => {
                const keyboard = e.currentTarget.checked
                const mouse = Boolean(room.remoteControl[peer.id]?.mouse)
                if (mouse || keyboard) void room.grantRemoteControl(peer.id, { mouse, keyboard })
                else void room.revokeRemoteControl(peer.id, 'host')
              }}
            />
            {L.remote_control_keyboard()}
          </label>
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
    <div bind:this={videoStage} class="video-overflow video-stage relative">
      <video
        bind:this={remoteScreen}
        id="remote_screen"
        class={videoClass}
        autoplay
        playsinline
        muted
        disablepictureinpicture
        ondblclick={onRemoteScreenDblClick}
        onmousemove={queueMove}
        onpointerdown={onRemotePointerDown}
        onpointerup={onRemotePointerUp}
        onpointercancel={onRemotePointerUp}
        onwheel={onRemoteWheel}
        oncontextmenu={onRemoteContextMenu}
      ></video>
      <button
        type="button"
        class="exit-fullscreen-btn btn btn-neutral btn-sm"
        title={L.exit_fullscreen()}
        aria-label={L.exit_fullscreen()}
        onpointerdown={(e) => e.stopPropagation()}
        onpointerup={(e) => e.stopPropagation()}
        onclick={onExitFullscreenClick}
      >
        <span class="icon">
          <i class="fa-solid fa-compress"></i>
        </span>
      </button>
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
  .exit-fullscreen-btn {
    display: none;
    position: absolute;
    top: 1rem;
    right: 1rem;
    z-index: 30;
    pointer-events: auto;
  }
  .video-stage:fullscreen,
  .video-stage:-webkit-full-screen {
    width: 100%;
    height: 100%;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .video-stage:fullscreen .video,
  .video-stage:-webkit-full-screen .video {
    width: 100%;
    height: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .video-stage:fullscreen .exit-fullscreen-btn,
  .video-stage:-webkit-full-screen .exit-fullscreen-btn {
    display: inline-flex;
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
