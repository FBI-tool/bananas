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
  import { debugLog } from './debugLog.svelte'
  import MacSidecarPermissions from './MacSidecarPermissions.svelte'
  import { connectThrownText } from './session/connectionFailureText'
  import { pointInVideoContent } from './session/videoContentPoint'
  import brokenVideoUrl from '../../assets/broken-video.svg?url'

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
  let username = $state('')
  let foregroundColor = $state('#1a1a1a')
  let backgroundColor = $state('#ffffff')
  let inviteInFlight = false
  let inviteFormIsVisible = $state(false)

  const showVideo = $derived(!room.isPresenter || Boolean(room.sessionEndedReason))
  const videoClass = $derived(room.sessionEndedReason ? 'video video-ended' : 'video')
  const showBrokenVideo = $derived(
    !room.isPresenter && (room.remoteDisplayActive === false || !room.remoteScreenActive),
  )
  const localGrant = $derived(room.localRemoteGrant)
  const controlling = $derived(Boolean(localGrant && (localGrant.mouse || localGrant.keyboard)))

  let pendingMove = $state<{ x: number; y: number } | null>(null)
  let moveFrame = 0
  let captureFocus = $state(false)
  let videoStage: HTMLDivElement | undefined = $state()

  const pointDetail = (point: { x: number; y: number } | null) =>
    point
      ? { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 }
      : null

  const contentPoint = (
    e: MouseEvent,
    opts?: { clamp?: boolean },
  ): { x: number; y: number } | null => {
    if (!remoteScreen) return null
    return pointInVideoContent(
      e.clientX,
      e.clientY,
      remoteScreen.getBoundingClientRect(),
      remoteScreen.videoWidth,
      remoteScreen.videoHeight,
      opts,
    )
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
    const holding = e.buttons !== 0
    const point = contentPoint(e, { clamp: holding })
    if (!point) {
      debugLog.sample('remote-input', 'viewer pointer move dropped', {
        buttons: e.buttons,
        type: e.type,
      })
      return
    }
    debugLog.sample('remote-input', 'viewer pointer move', {
      type: e.type,
      buttons: e.buttons,
      ...pointDetail(point),
    })
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
    const target = e.currentTarget
    if (target instanceof HTMLElement) {
      try {
        target.setPointerCapture(e.pointerId)
      } catch {
        // Capture is best-effort so a drag still ends on pointerup/cancel.
      }
    }
    const point = contentPoint(e, { clamp: true })
    debugLog.info('remote-input', 'viewer pointer down', {
      button: name,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      buttons: e.buttons,
      captured: target instanceof HTMLElement && target.hasPointerCapture(e.pointerId),
      ...pointDetail(point),
    })
    if (point) {
      pendingMove = point
      flushMove()
    }
    room.sendRemotePointerButton(name, 'down')
  }

  const onRemotePointerUp = (e: PointerEvent): void => {
    if (!localGrant?.mouse) return
    const name = buttonName(e.button)
    if (!name) return
    e.preventDefault()
    debugLog.info('remote-input', 'viewer pointer up', {
      button: name,
      type: e.type,
      pointerId: e.pointerId,
      buttons: e.buttons,
      ...pointDetail(contentPoint(e, { clamp: true })),
    })
    room.sendRemotePointerButton(name, 'up')
  }

  const onLostPointerCapture = (e: PointerEvent): void => {
    debugLog.warn('remote-input', 'viewer lost pointer capture', {
      pointerId: e.pointerId,
      buttons: e.buttons,
    })
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
    let keyboardLock: 'all' | 'escape' | 'off' = 'off'
    const requestKeyboardLock = (mode: 'all' | 'escape' | 'off'): void => {
      if (mode === keyboardLock) return
      keyboardLock = mode
      if (mode === 'off') {
        navigator.keyboard?.unlock()
        return
      }
      const pending =
        mode === 'all' ? navigator.keyboard?.lock() : navigator.keyboard?.lock(['Escape'])
      void pending?.catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error(error)
      })
    }
    const syncCapture = (): void => {
      const fullscreen = videoIsFullscreen()
      if (fullscreen) captureFocus = true
      const capturing = keyboardGrant && (fullscreen || captureFocus) && !fieldIsFocused()
      void window.KiwiApi.remoteControl.setLocalCapture(capturing)
      requestKeyboardLock(fullscreen ? (keyboardGrant ? 'all' : 'escape') : 'off')
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
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
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
    if (!showInvite || value === '') {
      connectionStringIsValid = null
      return
    }
    connectionStringIsValid = mayBeConnectionString(ConnectionType.PARTICIPANT, value)
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
    foregroundColor = settings.foregroundColor
    backgroundColor = settings.backgroundColor
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

  const leaveFullscreen = async (): Promise<void> => {
    if (!document.fullscreenElement) return
    await document.exitFullscreen().catch(() => undefined)
  }

  const onLeaveClick = async (): Promise<void> => {
    await leaveFullscreen()
    try {
      await room.leave()
    } catch (error) {
      console.error(error)
    }
    onReset()
  }

  const onEndSessionClick = async (): Promise<void> => {
    await leaveFullscreen()
    try {
      await room.endSession()
    } catch (error) {
      console.error(error)
    }
    onReset()
  }

  const onRequestPresent = async (): Promise<void> => {
    if (room.presentCapturePending) return
    const result = await room.requestToPresent()
    if (result === 'cooldown') toast.show('info', L.vote_cooldown())
    if (result === 'blocked') toast.show('info', L.vote_rejected())
    if (result === 'failed') toast.show('error', L.screen_share_failed())
  }

  const onRequestKick = async (peerId: string): Promise<void> => {
    const result = await room.requestKick(peerId)
    if (result === 'cooldown') toast.show('info', L.vote_remove_cooldown())
    if (result === 'blocked') toast.show('info', L.vote_remove_rejected())
  }

  const onChangeScreen = async (): Promise<void> => {
    const result = await room.changeScreen()
    if (result === 'failed') toast.show('error', L.screen_share_failed())
  }

  let inviteAnotherButton: HTMLButtonElement | undefined = $state()
  let inviteAnotherTextLoading = $state('')

  const onCopyInvite = async (): Promise<void> => {
    inviteAnotherButton.disabled = true
    inviteAnotherTextLoading = 'generating...'
    if (inviteInFlight) return
    inviteInFlight = true
    try {
      const offer = await room.CreateHostUrl({ username })
      if (!offer) {
        toast.show('error', L.room_is_full())
      } else {
        toast.show('success', 'Invite copied to clipboard')
        void navigator.clipboard.writeText(offer)
        inviteFormIsVisible = true
      }
    } catch (error) {
      console.error(error)
      toast.show('error', L.connection_failed())
    } finally {
      inviteInFlight = false
      inviteAnotherButton.disabled = false
      inviteAnotherTextLoading = ''
    }
  }

  const onConnectInvite = async (): Promise<void> => {
    try {
      const data = await getDataFromKiwiUrl(appState.hostUrl)
      await room.Connect(data.rtcSessionDescription, { invite: data.invite })
      appState.hostUrl = ''
    } catch (error) {
      console.error(error)
      toast.show('error', connectThrownText(error))
    }
  }

  const onRemoteScreenDblClick = (): void => {
    room.PingRemoteCursor(room.localPeerId || 'cursor-' + UUID)
  }

  const onRemoteScreenMouseMove = (e: MouseEvent): void => {
    if (!remoteScreen || room.isPresenter) return
    const point = contentPoint(e)
    if (!point) return
    room.UpdateRemoteCursor({
      x: point.x,
      y: point.y,
      name: username,
      id: 'cursor-' + UUID,
      foregroundColor,
      backgroundColor
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
        onclick={() => room.displayStreamActive ? onDisplayStreamToggle() : onChangeScreen()}
      >
        <span class="icon">
          <i class="fa-solid fa-display"></i>
        </span>
      </button>
      {#if room.displayStreamActive}
        <button class="btn btn-info" onclick={onChangeScreen}>
          <span class="icon">
            <i class="fa-solid fa-display"></i>
          </span>
          <span>{L.change_screen()}</span>
        </button>
        <button
          title={room.windowShare
            ? L.fullscreen_pointer_only()
            : room.cursorsEnabled
              ? L.remote_cursors_enabled()
              : L.remote_cursors_disabled()}
          class="btn {room.cursorsEnabled ? 'btn-success' : 'btn-error'}"
          disabled={room.windowShare}
          onclick={toggleRemoteCursors}
        >
          <span class="icon">
            <i class="fas fa-mouse-pointer"></i>
          </span>
        </button>
      {/if}
    {:else}
      <button
        class="btn btn-primary"
        onclick={onRequestPresent}
        disabled={Boolean(room.activeVote) || room.presentCapturePending}
      >
        <span>{L.request_to_present()}</span>
      </button>
      {#if room.remoteScreenActive}
        <button
          class="btn {controlling ? 'btn-success' : 'btn-warning'}"
          onclick={() => room.requestRemoteControl(true, true)}
          disabled={Boolean(room.localRemoteGrant)}
        >
          <span>{L.remote_control_request_button()}</span>
        </button>
      {/if}
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
    {#if showInvite && room.isCoordinator}
      <div class="flex flex-wrap gap-2 mb-4">
        <div class="join w-full mb-4">
          <span class="tooltip tooltip-top {inviteFormIsVisible ? 'hidden' : ''}" data-tip={inviteAnotherTextLoading === '' ? L.invite_another() : inviteAnotherTextLoading}>
            <button class="btn btn-primary" bind:this={inviteAnotherButton} aria-label={inviteAnotherTextLoading === '' ? L.invite_another() : inviteAnotherTextLoading} onclick={onCopyInvite}>
              <span class="icon">
                <i class="fa-solid fa-user-plus"></i>
              </span>
              {inviteAnotherTextLoading}
            </button>
          </span>
          <span class="tooltip tooltip-top" data-tip={L.cancel()}>
            <button
              class="btn join-item btn-error not-hover:btn-soft {inviteFormIsVisible ? '' : 'hidden'}"
              aria-label={L.cancel()}
              onclick={() => {
                inviteFormIsVisible = false
              }}
            >
              <span class="fa-solid fa-user"></span>
              <span class="fa-solid fa-ban"></span>
            </button>
          </span>
          <span class="flex-1 {inviteFormIsVisible ? '' : 'hidden'}">
            <span class="tooltip tooltip-top" data-tip={L.participant_connection_string()}>
              <input
                class="input join-item flex-3 max-w-24 {connectionInputClass}"
                bind:value={appState.hostUrl}
                type="text"
              />
            </span>
            <span class="tooltip tooltip-top" data-tip={L.connect()}>
              <button
                class="btn join-item {connectButtonClass}"
                aria-label={L.connect()}
                onclick={onConnectInvite}
                disabled={!connectionStringIsValid}
              >
                <span class="fa-solid fa-plug"></span>
              </button>
            </span>
          </span>
        </div>
      </div>
    {/if}
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
    {#if room.remoteControlCaps.backend === 'macos'}
      <MacSidecarPermissions
        caps={room.remoteControlCaps}
        onRequest={(capability) => room.requestRemoteControlPermission(capability)}
      />
    {:else if room.remoteControlCaps.unavailableReason === 'evdev-permission'}
      <p class="text-sm">{L.remote_control_evdev_permission()}</p>
    {:else if room.remoteControlCaps.unavailableReason === 'accessibility-permission'}
      <button class="btn btn-sm" onclick={() => room.requestRemoteControlPermission('post')}>
        {L.remote_control_request_permission()}
      </button>
    {/if}
  </div>
{/if}

{#each room.remoteControlRequests as request (request.peerId)}
  <div class="alert mb-4">
    <span>{L.remote_control_request({ name: request.username })}</span>
    <div class="flex flex-wrap gap-2">
      <button
        class="btn btn-sm"
        disabled={room.windowShare}
        title={room.windowShare ? L.fullscreen_pointer_only() : undefined}
        onclick={() => room.grantRemoteControl(request.peerId, { mouse: true, keyboard: false })}
      >
        {L.remote_control_allow_mouse()}
      </button>
      <button class="btn btn-sm" onclick={() => room.grantRemoteControl(request.peerId, { mouse: false, keyboard: true })}>
        {L.remote_control_allow_keyboard()}
      </button>
      <button
        class="btn btn-sm btn-primary"
        disabled={room.windowShare}
        title={room.windowShare ? L.fullscreen_pointer_only() : undefined}
        onclick={() => room.grantRemoteControl(request.peerId, { mouse: true, keyboard: true })}
      >
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
    {#if room.verification}
      <details class="collapse" name="e2ee-verification">
        <summary class="badge badge-success cursor-pointer pointer-none">
          {L.e2ee_on()}
          <span class="ml-1 text-success-content fa-solid fa-lock"></span>
        </summary>
        <div class="collapse-content mt-2 text-sm">
          <p><span class="font-semibold">{L.verification_code()}:</span> {room.verification.securityCode}</p>
          <p class="opacity-70">{L.verification()}</p>
          <div class="overflow-x-auto rounded-box border border-base-content/5 bg-base-100 max-w-fit">
            <table class="table max-w-fit">
              <thead>
                <tr>
                  <th>Peer ID</th>
                  <th>Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {#each room.verification.members as member (member.peerId)}
                  <tr>
                    <td>
                      {member.peerId.slice(0, 8)}
                      {member.peerId === room.localPeerId ? `(${L.you()})` : ''}
                    </td>
                    <td class="uppercase">{member.fingerprint}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    {/if}
  {:else if room.e2eeActive}
    <p class="badge badge-error">
      {L.e2ee_app_only()}
      <span class="ml-1 text-error-content fa-solid fa-triangle-exclamation"></span>
    </p>
  {:else}
    <p class="badge badge-warning">
      {L.e2ee_off()}
      <span class="ml-1 text-warning-content fa-solid fa-lock-open"></span>
    </p>
  {/if}
  {#if room.e2eeError}
    <p class="badge badge-warning">
      {L.e2ee_off()}
      <span class="ml-1 text-warning-content fa-solid fa-lock-open"></span>
    </p>
    <p class="text-error text-sm mt-1">
      {room.e2eeError}
    </p>
  {/if}
</div>

<div class="mb-4">
  <h2 class="font-semibold mb-2">{L.peer_list()}</h2>
  <div class="rounded-box border border-base-content/5 bg-base-100 max-w-fit">
    <table class="table">
      <thead>
        <tr class="bg-base-300">
          <th><span class="fa-solid fa-user"></span> {L.username()}</th>
          <th><span class="fa-solid fa-computer-mouse"></span> {L.remote_control_mouse()}</th>
          <th><span class="fa-solid fa-keyboard"></span> {L.remote_control_keyboard()}</th>
          <th><span class="fa-solid fa-people-group"></span> Actions</th>
        </tr>
      </thead>
      <tbody>
      {#each room.peers as peer (peer.id)}
        <tr class="hover:bg-base-200">
          <td>
            {peer.username}{peer.id === room.localPeerId ? ` (${L.you()})` : ''}
            {#if peer.id === room.coordinatorId}
              <span class="tooltip tooltip-top" data-tip={L.coordinator()}>
                <span class="text-info fa-solid fa-satellite-dish"></span>
              </span>
            {/if}
            {#if peer.id === room.presenterId}
              <span class="tooltip tooltip-top" data-tip={L.presenter()}>
                <span class="text-info fa-solid fa-desktop"></span>
              </span>
            {/if}
          </td>
          {#if room.isPresenter && peer.id !== room.localPeerId}
            <td>
              <label
                class="flex items-center gap-1"
                title={room.windowShare ? L.fullscreen_pointer_only() : undefined}
              >
                <input
                  type="checkbox"
                  class="checkbox"
                  disabled={!room.displayStreamActive || room.windowShare}
                  checked={Boolean(room.remoteControl[peer.id]?.mouse)}
                  onchange={(e) => {
                    const mouse = e.currentTarget.checked
                    const keyboard = Boolean(room.remoteControl[peer.id]?.keyboard)
                    if (mouse || keyboard) void room.grantRemoteControl(peer.id, { mouse, keyboard })
                    else void room.revokeRemoteControl(peer.id, 'host')
                  }}
                />
                </label>
            </td>
            <td>
              <label class="flex items-center gap-1">
                <input
                  type="checkbox"
                  class="checkbox"
                  disabled={room.displayStreamActive ? false : true}
                  checked={Boolean(room.remoteControl[peer.id]?.keyboard)}
                  onchange={(e) => {
                    const keyboard = e.currentTarget.checked
                    const mouse = Boolean(room.remoteControl[peer.id]?.mouse)
                    if (mouse || keyboard) void room.grantRemoteControl(peer.id, { mouse, keyboard })
                    else void room.revokeRemoteControl(peer.id, 'host')
                  }}
                />
              </label>
            </td>
            {:else}
              <td>
                {#if room.remoteControl[peer.id]?.mouse}
                  <span class="text-success fa-solid fa-check"></span>
                {/if}
              </td>
              <td>
                {#if room.remoteControl[peer.id]?.keyboard}
                  <span class="text-success fa-solid fa-check"></span>
                {/if}
              </td>
            {/if}
            <td>
            {#if peer.id !== room.localPeerId}
              <span class="tooltip tooltip-top" data-tip={L.remove_from_session()}>
                <button
                  type="button"
                  class="btn btn-ghost hover:btn-warning"
                  aria-label={L.remove_from_session()}
                  disabled={Boolean(room.activeVote) || !room.canRequestKick(peer.id)}
                  onclick={() => onRequestKick(peer.id)}
                >
                  <span class="icon">
                    <i class="fa-solid fa-user-minus"></i>
                  </span>
                </button>
              </span>
            {/if}
          </td>
        </tr>
      {/each}
      </tbody>
    </table>
  </div>
</div>

<div class={showVideo ? 'relative' : 'hidden'}>
  <fieldset class="fieldset px-0">
    <legend class="fieldset-legend">{L.remote_screen()}</legend>
    <div bind:this={videoStage} class="video-overflow video-stage relative">
      {#if showBrokenVideo}
        <div class="broken-video" aria-hidden="true">
          <img src={brokenVideoUrl} alt="" />
        </div>
      {/if}
      <video
        bind:this={remoteScreen}
        id="remote_screen"
        class="{videoClass} {showBrokenVideo ? 'video-off' : ''}"
        autoplay
        playsinline
        muted
        disablepictureinpicture
        ondblclick={onRemoteScreenDblClick}
        onmousemove={queueMove}
        onpointermove={queueMove}
        onpointerdown={onRemotePointerDown}
        onpointerup={onRemotePointerUp}
        onpointercancel={onRemotePointerUp}
        onlostpointercapture={onLostPointerCapture}
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

<SessionEndedOverlay
  reason={room.sessionEndedReason}
  onDismiss={() => {
    room.dismissSessionEnded()
    onReset()
  }}
/>

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
  .video-off {
    display: none;
  }
  .broken-video {
    width: 100%;
    aspect-ratio: 16 / 9;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-base-200);
  }
  .broken-video img {
    width: min(34%, 11rem);
    height: auto;
  }
  @media (prefers-color-scheme: dark) {
    .broken-video img {
      filter: invert(1);
      opacity: 0.8;
    }
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
  .video-stage:fullscreen .broken-video,
  .video-stage:-webkit-full-screen .broken-video {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
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
