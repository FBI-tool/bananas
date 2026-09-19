<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import { appState } from './appState.svelte'
  import { toast } from './toastState.svelte'
  import { sessionRoom as room } from './session/sessionStore.svelte'
  import SessionStage from './SessionStage.svelte'
  import {
    mergeIncomingCallSignal,
    type BonjourSignalPayload,
    type IncomingBonjourCall,
  } from './session/bonjourSignal'
  import { applyContactPresence, isPresenceStatus } from './bonjourPresence'
  import { debugLog } from './debugLog.svelte'
  import type { BonjourServerError } from './../../main/bonjour/types'
  import { BonjourServerErrorEnum } from '../../main/bonjour/enums';

  const CONTACTS_POLL_MS = 30_000

  let remoteScreen: HTMLVideoElement | undefined = $state()
  const BonjourRequestProgressEnum = {
    'WAITING': 'waiting',
  } as const
  type BonjourRequestProgress = {
    requestState: typeof BonjourRequestProgressEnum[keyof typeof BonjourRequestProgressEnum]
  }
  let me = $state<{
    userId: string
    username: string | null
    acceptRequestsUntil: string | null
    acceptCallJoins: boolean
  } | BonjourServerError | BonjourRequestProgress>({requestState: BonjourRequestProgressEnum.WAITING})
  let modalAddUserVisible = $state(false)
  let usernameDraft = $state('')
  let addUsername = $state('')
  // let listName = $state('')
  let contacts = $state<
    Array<{
      userId: string
      username: string
      devicePublicKey: string | null
      presence: 'available' | 'busy' | 'offline'
      acceptCallJoins: boolean
    }>
  >([])
  let incoming = $state<Array<{ id: string; fromUserId: string; username: string }>>([])
  let outgoing = $state<Array<{ id: string; toUserId: string; username: string }>>([])
  let ignored = $state<Array<{ userId: string; username: string }>>([])
  // let lists = $state<Array<{ id: string; name: string; memberIds: string[] }>>([])
  let incomingCall = $state<IncomingBonjourCall | null>(null)
  let sessionStarted = $state(false)
  let outgoingCallId: string | null = null
  let peerKeys = new Map<string, string>()
  let activePeerId = $state<string | null>(null)
  let signalingFailed = false
  let lastPresence: 'available' | 'busy' | null = null
  let signalQueue: Promise<void> = Promise.resolve()
  let pendingSignals: Array<{
    callId?: string
    senderId?: string
    plain: BonjourSignalPayload
  }> = []

  const contactName = (userId: string): string =>
    contacts.find((contact) => contact.userId === userId)?.username ?? userId

  const keyFor = (peerId: string | null | undefined): string | null => {
    if (!peerId) return null
    return (
      peerKeys.get(peerId) ??
      incomingCall?.peerPublicKey ??
      contacts.find((contact) => contact.userId === peerId)?.devicePublicKey ??
      null
    )
  }

  const refresh = async (): Promise<void> => {
    me = await window.KiwiApi.bonjour.me()
    if (!me?.username) return
    contacts = await window.KiwiApi.bonjour.contacts()
    incoming = await window.KiwiApi.bonjour.incoming()
    outgoing = await window.KiwiApi.bonjour.outgoing()
    ignored = await window.KiwiApi.bonjour.ignored()
    // lists = await window.KiwiApi.bonjour.lists()
    peerKeys = new Map(
      contacts
        .filter((contact) => contact.devicePublicKey)
        .map((contact) => [contact.userId, contact.devicePublicKey as string]),
    )
  }

  const sendSignal = (payload: BonjourSignalPayload): void => {
    const callId = room.bonjourCallId
    const key = keyFor(activePeerId)
    if (!callId || !key) {
      if (payload.type === 'offer' || payload.type === 'answer' || payload.type === 'mls-invite') {
        signalingFailed = true
        toast.show('error', 'contact has no encryption key yet; ask them to sign in again')
      }
      return
    }
    const post = async (): Promise<void> => {
      await window.KiwiApi.bonjour.signal(callId, payload.type, key, payload)
    }
    if (payload.type === 'ice') {
      signalQueue = signalQueue.then(post).catch(() => undefined)
      return
    }
    if (signalingFailed) return
    signalQueue = signalQueue.then(post).catch((error) => {
      if (signalingFailed) return
      signalingFailed = true
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    })
  }

  const bindPeer = (peerId: string, publicKey?: string | null): void => {
    activePeerId = peerId
    if (publicKey) peerKeys.set(peerId, publicKey)
    room.bindBonjour(sendSignal)
  }

  const applyPlainSignal = (event: {
    callId?: string
    senderId?: string
    plain: BonjourSignalPayload
  }): void => {
    if (event.callId && room.bonjourCallId && event.callId !== room.bonjourCallId) return
    if (event.senderId) activePeerId = event.senderId
    void room.applyBonjourSignal(event.plain).catch((error) => {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    })
  }

  const flushPendingSignals = (): void => {
    const queued = pendingSignals
    pendingSignals = []
    for (const event of queued) applyPlainSignal(event)
  }

  onMount(() => {
    room.bindBonjour(sendSignal)
    window.KiwiApi.bonjour.onAuth((payload) => {
      me = (payload as typeof me) ?? null
      void refresh()
    })
    window.KiwiApi.bonjour.onEvent((raw) => {
      const event = raw as {
        type: string
        callId?: string
        fromUserId?: string
        userId?: string
        status?: string
        kind?: string
        senderId?: string
        signalType?: string
        devicePublicKey?: string | null
        ciphertextOmitted?: boolean
        plain?: BonjourSignalPayload | null
      }
      if (event.type === 'incoming-call' && event.callId && event.fromUserId) {
        if (sessionStarted || room.isLive) return
        if (incomingCall?.callId === event.callId) return
        const peerPublicKey =
          (typeof event.devicePublicKey === 'string' && event.devicePublicKey) ||
          peerKeys.get(event.fromUserId) ||
          null
        if (peerPublicKey) peerKeys.set(event.fromUserId, peerPublicKey)
        incomingCall = {
          callId: event.callId,
          fromUserId: event.fromUserId,
          kind: String(event.kind ?? 'start'),
          peerPublicKey,
        }
        if (appState.activeView !== 'bonjour') {
          appState.activeView = 'bonjour'
        }
      }
      if (event.type === 'signal' && !event.plain && event.signalType && event.signalType !== 'ice') {
        toast.show('error', L.bonjour_error())
      }
      if (event.type === 'signal' && event.plain) {
        if (incomingCall) incomingCall = mergeIncomingCallSignal(incomingCall, event)
        if (event.plain.type === 'hangup') {
          incomingCall = null
          pendingSignals = []
          if (!room.bonjourCallId) {
            reset()
            return
          }
        }
        if (!room.bonjourCallId) {
          if (event.plain.type !== 'hangup') {
            pendingSignals.push({
              callId: event.callId,
              senderId: event.senderId,
              plain: event.plain,
            })
          }
          return
        }
        applyPlainSignal({
          callId: event.callId,
          senderId: event.senderId,
          plain: event.plain,
        })
        if (event.plain.type === 'hangup') reset()
      }
      if (event.type === 'call-accepted' && event.callId && room.bonjourCallId === event.callId) {
        void refresh()
      }
      if (event.type === 'contact-request' || event.type === 'contact-accepted') {
        void refresh()
      }
      if (event.type === 'presence') {
        if (!event.userId || (me && 'error' in me === false && 'requestState' in me === false && event.userId === me.userId)) return
        if (!isPresenceStatus(event.status)) {
          debugLog.warn('bonjour', 'presence event missing status', { userId: event.userId })
          void refresh()
          return
        }
        debugLog.info('bonjour', 'presence event', { userId: event.userId, status: event.status })
        const next = applyContactPresence(contacts, event.userId, event.status)
        if (next !== contacts) {
          contacts = next
          return
        }
        void refresh()
      }
    })
    void refresh()
    const poll = setInterval(() => {
      if ('error' in me === false && 'requestState' in me === false && !me?.username) return
      void refresh()
    }, CONTACTS_POLL_MS)
    return (): void => {
      clearInterval(poll)
      void window.KiwiApi.bonjour.setPresence('offline')
    }
  })

  $effect(() => {
    const busy = room.isLive || sessionStarted || appState.isHosting || appState.isWatching
    const next = busy ? 'busy' : 'available'
    if (next === lastPresence) return
    lastPresence = next
    void window.KiwiApi.bonjour.setPresence(next)
  })

  $effect(() => {
    if (appState.activeView !== 'bonjour') return
    switch (room.connectionState) {
      case 'connected':
        toast.show('success', L.connection_established())
        break
      case 'failed':
        toast.show('error', L.connection_failed())
        break
      default:
        break
    }
  })

  const onLogin = (): void => {
    void window.KiwiApi.bonjour.login()
  }

  const onClaim = async (): Promise<void> => {
    try {
      await window.KiwiApi.bonjour.claimUsername(usernameDraft)
      await refresh()
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    }
  }

  const onAdd = async (): Promise<void> => {
    try {
      await window.KiwiApi.bonjour.request(addUsername)
      addUsername = ''
      await refresh()
      modalAddUserVisible = false
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
    }
  }

  const onCall = async (contact: (typeof contacts)[0], kind: 'start' | 'join'): Promise<void> => {
    try {
      if (!contact.devicePublicKey) {
        throw new Error('contact has no encryption key yet; ask them to sign in again')
      }
      signalingFailed = false
      if (kind === 'start' && !room.isLive && !sessionStarted) {
        const setup = await room.Setup(null, { captureDisplay: false })
        if (setup !== 'ok') {
          toast.show('error', L.connection_failed())
          return
        }
        sessionStarted = true
        appState.isHosting = true
        appState.isCoordinator = true
        appState.navigationEnabled = false
      }
      if (kind === 'join' && !room.isLive) {
        const setup = await room.Setup(remoteScreen ?? document.createElement('video'))
        if (setup !== 'ok') {
          toast.show('error', L.connection_failed())
          return
        }
        appState.isWatching = true
        appState.navigationEnabled = false
        sessionStarted = true
      }
      const started = await window.KiwiApi.bonjour.startCall(contact.userId, kind)
      outgoingCallId = started.callId
      bindPeer(contact.userId, contact.devicePublicKey)
      if (kind === 'start') {
        await room.startBonjourCall({ callId: started.callId, peerId: contact.userId })
        flushPendingSignals()
        return
      }
      await room.requestBonjourJoin({ callId: started.callId, peerId: contact.userId })
      flushPendingSignals()
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
      if (sessionStarted && !room.isLive) {
        await room.Disconnect()
        reset()
      }
    }
  }

  const onAcceptCall = async (): Promise<void> => {
    if (!incomingCall) return
    const call = incomingCall
    incomingCall = null
    try {
      signalingFailed = false
      let key = call.peerPublicKey ?? keyFor(call.fromUserId)
      if (!key) {
        await refresh()
        key = keyFor(call.fromUserId)
      }
      if (!key) {
        throw new Error('contact has no encryption key yet; ask them to sign in again')
      }
      await window.KiwiApi.bonjour.acceptCall(call.callId)
      if (room.isLive || (call.kind === 'join' && appState.isHosting)) {
        bindPeer(call.fromUserId, key)
        await room.startBonjourCall({ callId: call.callId, peerId: call.fromUserId })
        flushPendingSignals()
        return
      }
      const setup = await room.Setup(remoteScreen ?? document.createElement('video'))
      if (setup !== 'ok') return
      bindPeer(call.fromUserId, key)
      appState.isWatching = true
      appState.navigationEnabled = false
      sessionStarted = true
      if (call.offer) {
        await room.acceptBonjourCall({
          callId: call.callId,
          peerId: call.fromUserId,
          offer: call.offer,
          invite: call.invite,
        })
      } else {
        await room.requestBonjourJoin({ callId: call.callId, peerId: call.fromUserId })
      }
      flushPendingSignals()
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : L.bonjour_error())
      if (sessionStarted && !room.isLive) {
        await room.Disconnect()
        reset()
      }
    }
  }

  const reset = (): void => {
    sessionStarted = false
    signalingFailed = false
    incomingCall = null
    pendingSignals = []
    outgoingCallId = null
    activePeerId = null
    lastPresence = null
    appState.navigationEnabled = true
    appState.isHosting = false
    appState.isWatching = false
    appState.isCoordinator = false
    void window.KiwiApi.bonjour.setPresence('available')
  }

  const onDisconnectClick = async (): Promise<void> => {
    const callId = room.bonjourCallId ?? outgoingCallId
    if (callId) void window.KiwiApi.bonjour.hangup(callId).catch(() => undefined)
    await room.Disconnect()
    reset()
  }

  // const addMember = async (listId: string, peerId: string): Promise<void> => {
  //   if (!peerId) return
  //   await window.KiwiApi.bonjour.addListMember(listId, peerId)
  //   await refresh()
  // }
</script>

<h1 class="text-3xl font-bold mb-4">{L.bonjour()}</h1>

{#if sessionStarted && !room.isLive && !room.sessionEndedReason}
  <div class="flex flex-wrap gap-2 mb-4">
    <button class="btn btn-primary" disabled>
      <span class="loading loading-spinner"></span>
      <span>{L.session_started()}</span>
    </button>
    <button class="btn btn-error" onclick={onDisconnectClick}>
      <span class="icon">
        <i class="fas fa-unlink"></i>
      </span>
      <span>{L.cancel()}</span>
    </button>
  </div>
{/if}

{#if (room.isLive || room.sessionEndedReason) && appState.activeView === 'bonjour'}
  <SessionStage {room} bind:remoteScreen showInvite={false} onReset={reset} />
{/if}

{#if !sessionStarted}
{#if !me || ('error' in me === true && me.error === BonjourServerErrorEnum.SERVER_UNAUTHORIZED)}
  <p class="mb-4">{L.bonjour_sign_in_description()}</p>
  <button class="btn btn-primary" onclick={onLogin}>{L.bonjour_sign_in()}</button>
{:else if 'error' in me === false && 'requestState' in me === false && !me.username}
  <p class="mb-4">{L.bonjour_choose_username()}</p>
  <div class="join mb-4">
    <input class="input join-item" bind:value={usernameDraft} placeholder={L.username()} />
    <button class="btn btn-primary join-item" onclick={onClaim}>{L.save()}</button>
  </div>
{:else if 'error' in me === true}
  <div role="alert" class="alert alert-error text-xl">
    <i class="fa-solid fa-triangle-exclamation"></i>
    <span>{me.error}</span>
  </div>
{:else if 'requestState' in me === true}
  <div class="text-center">
    <span class="loading loading-spinner loading-xl text-info"></span>
  </div>
{:else}
  <div class="grid grid-cols-[auto_1fr] gap-4 mb-4 items-center">
    <div class="avatar avatar-online avatar-placeholder">
      <div class="bg-neutral text-neutral-content w-24 rounded-full">
        <i class="fa-solid fa-user text-3xl"></i>
      </div>
    </div>
    <div>
      <h1 class="text-xl text-accent">
        <span class="tooltip" data-tip={L.username()}>
          {me.username}
        </span>
      </h1>
      <button class="btn btn-sm btn-soft hover:btn-warning" onclick={() => window.KiwiApi.bonjour.logout()}>{L.bonjour_sign_out()}</button>
    </div>
  </div>
  {#if incoming.length}
    <h2 class="text-xl font-semibold mb-2">{L.bonjour_incoming()}</h2>
    {#each incoming as req (req.id)}
      <div class="flex gap-2 mb-2 items-center">
        <span>{req.username}</span>
        <button class="btn btn-sm btn-success" onclick={() => window.KiwiApi.bonjour.respond(req.id, 'accept').then(refresh)}>{L.approve()}</button>
        <button class="btn btn-sm" onclick={() => window.KiwiApi.bonjour.respond(req.id, 'decline').then(refresh)}>{L.deny()}</button>
        <button class="btn btn-sm btn-ghost" onclick={() => window.KiwiApi.bonjour.ignore(req.id).then(refresh)}>{L.bonjour_ignore()}</button>
      </div>
    {/each}
  {/if}

  {#if outgoing.length}
    <h2 class="text-xl font-semibold mb-2">{L.bonjour_outgoing()}</h2>
    {#each outgoing as req (req.id)}
      <div class="flex gap-2 mb-2 items-center">
        <span>{req.username}</span>
        <button class="btn btn-sm" onclick={() => window.KiwiApi.bonjour.retract(req.id).then(refresh)}>{L.cancel()}</button>
      </div>
    {/each}
  {/if}
    <h2 class="text-3xl">{L.bonjour_contacts()}</h2>
    <div class="bg-base-200 max-w-max rounded-box">
        <ul class="menu menu-horizontal">
          <!-- <li> -->
          <!--   <button -->
          <!--     class="btn btn-ghost btn-circle hover:text-info" -->
          <!--     aria-label={L.bonjour_lists()} -->
          <!--     onclick={()=>modalAddUserVisible=!modalAddUserVisible}> -->
          <!--     <span class="tooltip" data-tip={L.bonjour_lists()}> -->
          <!--       <i class=" fa-solid fa-address-book text-xl"></i> -->
          <!--     </span> -->
          <!--   </button> -->
          <!-- </li> -->
          <li>
            <button
              class="btn btn-ghost btn-circle hover:text-info"
                aria-label={L.bonjour_add_contact()}
                onclick={()=>modalAddUserVisible=!modalAddUserVisible}>
              <span class="tooltip" data-tip={L.bonjour_add_contact()}>
                <i class=" fa-solid fa-user-plus text-xl"></i>
              </span>
            </button>
          </li>
          <li>
            <button
              class="btn btn-ghost btn-circle"
                aria-label={L.bonjour_add_contact()}
                data-active={Boolean(me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now()) ? '1' : '0'}
                onclick={(event)=>{
                  const newState = event.currentTarget.dataset.active === '1' ? false : true
                  event.currentTarget.dataset.active = newState ? '1' : '0'
                  void window.KiwiApi.bonjour.setAcceptRequests(newState).then(() => refresh())
                }}>
              <span class="tooltip" data-tip={L.bonjour_accept_requests() + (me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now() ? ` until ${new Date(me.acceptRequestsUntil).toLocaleString()}` : '')}>
                <i class="fa-solid fa-user-group text-xl {me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now() ? 'text-warning' : ''}"></i>
              </span>
            </button>
          </li>
          <li>
            <button
              class="btn btn-ghost btn-circle"
                aria-label={L.bonjour_add_contact()}
                data-active={me.acceptCallJoins ? '1' : '0'}
                onclick={(event)=>{
                  const newState = event.currentTarget.dataset.active === '1' ? false : true
                  event.currentTarget.dataset.active = newState ? '1' : '0'
                  void window.KiwiApi.bonjour.setAcceptCallJoins(newState).then(() => refresh())
                }}>
              <span class="tooltip" data-tip={L.bonjour_accept_call_joins() + (me.acceptRequestsUntil && Date.parse(me.acceptRequestsUntil) > Date.now() ? ` until ${new Date(me.acceptRequestsUntil).toLocaleString()}` : '')}>
                <i class="fa-solid fa-bell text-xl {me.acceptCallJoins ? 'text-warning' : ''}"></i>
              </span>
            </button>
            </li>
          </ul>
      </div>

    <dialog class="modal{modalAddUserVisible ? ' modal-open' : ''}">
      <div class="modal-box">
        <form method="dialog">
          <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" onclick={()=>modalAddUserVisible=!modalAddUserVisible}>✕</button>
        </form>
        <h2 class="text-xl font-semibold mb-2">{L.bonjour_add_contact()}</h2>
        <div class="join mb-4">
          <form class="form join" onsubmit={(event) => { event.preventDefault(); onAdd(); }}>
            <input class="input join-item" bind:value={addUsername} placeholder={L.username()} />
            <button class="btn btn-accent join-item">{L.bonjour_send_request()}</button>
          </form>
        </div>
      </div>
    </dialog>

    <ul class="list bg-base-100 rounded-box shadow-md max-w-max">
      {#each contacts as contact (contact.userId)}
      <li class="list-row grid gap-2 items-center {contact.presence === 'offline' ? 'opacity-30' : ''}">
        <div>
          <span class="tooltip" data-tip={contact.presence}>
            <div class="grid grid-cols-[auto_1fr] gap-4 items-center">
              <div class="avatar avatar-placeholder {contact.presence === 'available' ? 'avatar-online' : 'avatar-offline'} {contact.presence === 'available' ? 'text-success' : contact.presence === 'busy' ? 'text-warning' : 'text-error'}">
                <div class="w-10 rounded-full">
                  <i class="fa-solid fa-user"></i>
                </div>
              </div>
            </div>
          </span>
        </div>
        <div>
          <div>{contact.username}</div>
        </div>
        {#if contact.presence === 'available'}
          <button class="btn btn-square btn-ghost hover:btn-success" aria-label={L.bonjour_call()} onclick={() => onCall(contact, 'start')}>
            <i class="fas fa-phone"></i>
          </button>
        {/if}
        {#if contact.presence === 'busy' && contact.acceptCallJoins}
          <button class="btn btn-sm" onclick={() => onCall(contact, 'join')}>{L.bonjour_ask_to_join()}</button>
        {/if}
        <button class="btn btn-square btn-ghost hover:btn-error" aria-label={L.bonjour_remove()} onclick={() => {
          const reply = window.confirm(`${L.bonjour_remove()} ${contact.username}?`);
          if (!reply) return;
          window.KiwiApi.bonjour.removeContact(contact.userId).then(refresh);}
        }>
          <i class="fa-solid fa-user-minus"></i>
        </button>
      </li>
    {/each}
  </ul>
<!--
  <h2 class="text-xl font-semibold mt-4 mb-2">{L.bonjour_lists()}</h2>
  <div class="join mb-4">
    <input class="input join-item" bind:value={listName} />
    <button
      class="btn join-item"
      onclick={() => window.KiwiApi.bonjour.createList(listName).then(() => { listName = ''; return refresh() })}
    >{L.bonjour_create_list()}</button>
  </div>
  {#each lists as list (list.id)}
    <div class="mb-3">
      <div class="flex gap-2 items-center mb-1">
        <strong>{list.name}</strong>
        <button class="btn btn-xs btn-ghost" onclick={() => window.KiwiApi.bonjour.deleteList(list.id).then(refresh)}>{L.bonjour_delete_list()}</button>
      </div>
      <div class="flex flex-wrap gap-2 mb-1">
        {#each list.memberIds as memberId (memberId)}
          <span class="badge gap-1">
            {contactName(memberId)}
            <button
              class="btn btn-ghost btn-xs"
              onclick={() => window.KiwiApi.bonjour.removeListMember(list.id, memberId).then(refresh)}
            >×</button>
          </span>
        {/each}
      </div>
      <select
        class="select select-sm select-bordered"
        onchange={(event) => {
          const peerId = event.currentTarget.value
          event.currentTarget.value = ''
          void addMember(list.id, peerId)
        }}
      >
        <option value="">{L.bonjour_add_contact()}</option>
        {#each contacts.filter((contact) => !list.memberIds.includes(contact.userId)) as contact (contact.userId)}
          <option value={contact.userId}>{contact.username}</option>
        {/each}
      </select>
    </div>
  {/each}
-->

  {#if ignored.length}
    <h2 class="text-xl font-semibold mt-4 mb-2">{L.bonjour_ignored()}</h2>
    {#each ignored as row (row.userId)}
      <div class="flex gap-2 mb-2 items-center">
        <span>{row.username}</span>
        <button class="btn btn-sm" onclick={() => window.KiwiApi.bonjour.unignore(row.userId).then(refresh)}>{L.bonjour_unignore()}</button>
      </div>
    {/each}
  {/if}
{/if}
{/if}
<video bind:this={remoteScreen} class={room.isLive && appState.activeView === 'bonjour' ? '' : 'hidden'} autoplay></video>

{#if incomingCall}
  <div class="toast">
    <div class="alert alert-soft">
      <div class="hero min-w-0 max-w-full">
        <div class="hero-content flex-col lg:flex-row">
          <div class="avatar avatar-online avatar-placeholder">
            <div class="bg-neutral text-neutral-content w-16 rounded-full">
              <i class="fa-solid fa-phone text-2xl"></i>
            </div>
          </div>
          <div>
            <h1 class="text-xl font-bold">{L.bonjour_incoming_call()}</h1>
            <p class="py-6">
              {contactName(incomingCall.fromUserId)}
            </p>
            <button class="btn btn-success" onclick={onAcceptCall}>{L.approve()}</button>
            <button class="btn btn-error" onclick={() => { if (incomingCall) void window.KiwiApi.bonjour.rejectCall(incomingCall.callId); incomingCall = null }}>{L.deny()}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
