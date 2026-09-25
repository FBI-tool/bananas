<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import { appState } from './appState.svelte'
  import { toast } from './toastState.svelte'
  import { debugLog } from './debugLog.svelte'
  import {
    mayBeConnectionString,
    getDataFromKiwiUrl,
    ConnectionType,
  } from './Utils'
  import { sessionRoom as room } from './session/sessionStore.svelte'
  import { connectThrownText, iceFailureText } from './session/connectionFailureText'
  import { recoverFailedConnection } from './session/recoverFailedConnection'

  let sessionStarted = $state(false)
  let connectionStringIsValid = $state<boolean | null>(null)
  let connectToUserName = $state('')
  let startingSession = $state(false)
  let username = $state('')
  let copiedConnectionString: string | null = null
  let copyInFlight = false

  $effect(() => {
    const value = appState.hostUrl
    void (async (): Promise<void> => {
      if (value === '' || room.isLive) {
        if (!room.isLive) connectionStringIsValid = null
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
    if (appState.sessionSource !== 'host') return
    switch (room.connectionState) {
      case 'connected':
        toast.show('success', L.connection_established())
        break
      case 'failed':
        debugLog.error('host', 'connectionState failed')
        toast.show('error', iceFailureText(room.connectionFailure))
        recoverFailedConnection()
        break
      case 'closed':
        if (!room.sessionEndedReason) toast.show('info', L.connection_closed())
        break
      default:
        break
    }
  })

  const onConnectClick = async (): Promise<void> => {
    try {
      const data = await getDataFromKiwiUrl(appState.hostUrl)
      await room.Connect(data.rtcSessionDescription, { invite: data.invite })
      appState.hostUrl = ''
    } catch (error) {
      console.error(error)
      debugLog.error('host', 'Connect participant string failed', error)
      toast.show('error', connectThrownText(error))
    }
  }

  const onCopyClick = async (): Promise<void> => {
    if (copiedConnectionString) {
      void navigator.clipboard.writeText(copiedConnectionString)
      return
    }
    if (copyInFlight) return
    copyInFlight = true
    try {
      const offer = await room.CreateHostUrl({
        username
      })
      if (!offer) {
        toast.show('error', L.room_is_full())
      } else {
        copiedConnectionString = offer
        void navigator.clipboard.writeText(offer)
      }
    } catch (error) {
      console.error(error)
      debugLog.error('host', 'Copy host string failed', error)
      toast.show('error', L.connection_failed())
    } finally {
      copyInFlight = false
    }
  }

  onMount(async () => {
    const settings = await window.KiwiApi.getSettings()
    username = settings.username
  })

  const onStartSessionButtonClick = async (): Promise<void> => {
    if (startingSession) return
    startingSession = true
    try {
      const setupResult = await room.Setup()
      if (setupResult === 'cancelled') return
      if (setupResult !== 'ok') {
        toast.show('error', L.screen_share_failed())
        return
      }
      sessionStarted = true
      appState.navigationEnabled = false
      appState.isHosting = true
      appState.isCoordinator = true
      appState.beginSession('host', reset)
    } finally {
      startingSession = false
    }
  }

  const reset = (): void => {
    appState.hostUrl = ''
    connectionStringIsValid = null
    copiedConnectionString = null
    copyInFlight = false
    sessionStarted = false
    appState.navigationEnabled = true
    appState.isHosting = false
    appState.isCoordinator = false
    appState.clearSession()
  }

  const onDisconnectClick = async (): Promise<void> => {
    await room.Disconnect()
    reset()
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
  <h1 class="text-3xl font-bold mb-4">
    {!room.isLive ? L.host_a_session() : L.hosting_a_session()}
  </h1>

  {#if sessionStarted && !room.isLive && !room.sessionEndedReason}
    <div class="flex flex-wrap gap-2 mb-4">
      <button class="btn btn-primary" disabled>
        <span class="icon">
          <i class="fas fa-play"></i>
        </span>
        <span>{L.session_started()}</span>
      </button>
      <button class="btn btn-error" onclick={onDisconnectClick}>
        <span class="icon">
          <i class="fas fa-unlink"></i>
        </span>
        <span>{L.cancel()}</span>
      </button>
      <button class="btn btn-primary" onclick={onCopyClick}>
        <span class="icon">
          <i class="fas fa-copy"></i>
        </span>
        <span>{L.copy_my_connection_string()}</span>
      </button>
    </div>
    <div class="join w-full">
      <label class="input join-item flex-1 {connectionInputClass}">
        <i class="fas fa-user"></i>
        <input
          bind:value={appState.hostUrl}
          placeholder={L.participant_connection_string()}
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

  {#if !sessionStarted}
    <div class="flex flex-wrap gap-2 mb-4">
      <button
        class="btn btn-primary {startingSession ? 'pointer-events-none' : ''}"
        disabled={startingSession}
        onclick={onStartSessionButtonClick}
      >
        {#if startingSession}
          <span class="loading loading-spinner"></span>
        {:else}
          <span class="icon">
            <i class="fas fa-play"></i>
          </span>
        {/if}
        <span>{L.start_a_new_session()}</span>
      </button>
    </div>
  {/if}
</div>
