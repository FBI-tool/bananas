<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import {
    mayBeConnectionString,
    getDataFromKiwiUrl,
    ConnectionType,
  } from './Utils'
  import { appState } from './appState.svelte'
  import { toast } from './toastState.svelte'
  import { debugLog } from './debugLog.svelte'
  import { sessionRoom as room } from './session/sessionStore.svelte'
  import { connectThrownText, iceFailureText } from './session/connectionFailureText'
  import { recoverFailedConnection } from './session/recoverFailedConnection'

  let isConnected = $state(false)
  let connectionStringIsValid = $state<boolean | null>(null)
  let connectToUserName = $state('')
  let username = $state('')
  let copiedConnectionString: string | null = null
  let copyInFlight = false

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
    if (appState.sessionSource !== 'join') return
    switch (room.connectionState) {
      case 'connected':
        toast.show('success', L.connection_established())
        break
      case 'failed':
        debugLog.error('join', 'connectionState failed')
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
    const setupResult = await room.Setup(document.createElement('video'))
    if (setupResult !== 'ok') {
      debugLog.error('join', `Setup returned ${setupResult}`)
      toast.show('error', L.connection_failed())
      return
    }
    try {
      const data = await getDataFromKiwiUrl(appState.participantUrl)
      debugLog.info('join', 'parsed host URL', {
        type: data.type,
        username: data.data.username,
        sdpType: data.rtcSessionDescription.type,
        sdpChars: data.rtcSessionDescription.sdp?.length ?? 0,
      })
      await room.Connect(data.rtcSessionDescription, { invite: data.invite })
      isConnected = true
      appState.isWatching = true
      appState.navigationEnabled = false
      appState.beginSession('join', reset)
    } catch (error) {
      console.error(error)
      debugLog.error('join', 'Connect click failed', error)
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
      const remoteData = await getDataFromKiwiUrl(appState.participantUrl)
      const data = await room.CreateParticipantUrl(remoteData.rtcSessionDescription, {
        username
      })
      copiedConnectionString = data
      void navigator.clipboard.writeText(data)
    } catch (error) {
      console.error(error)
      debugLog.error('join', 'Copy participant string failed', error)
      toast.show('error', L.connection_failed())
    } finally {
      copyInFlight = false
    }
  }

  onMount(async () => {
    const settings = await window.KiwiApi.getSettings()
    username = settings.username
  })

  const reset = (): void => {
    appState.participantUrl = ''
    connectionStringIsValid = null
    isConnected = false
    copiedConnectionString = null
    copyInFlight = false
    appState.navigationEnabled = true
    appState.isWatching = false
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
    {!room.isLive ? L.join_a_session() : L.joined_a_session()}
  </h1>

  {#if !room.isLive && !isConnected && !room.sessionEndedReason}
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

  {#if isConnected && !room.isLive && !room.sessionEndedReason}
    <div class="flex gap-2 mb-4">
      <button class="btn btn-primary" onclick={onCopyClick}>
        <span class="icon">
          <i class="fas fa-copy"></i>
        </span>
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
