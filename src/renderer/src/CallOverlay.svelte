<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import type { CallCameraMid, CallChatMessage, CallPeerInfo } from './callTypes'

  let peers = $state<CallPeerInfo[]>([])
  let messages = $state<CallChatMessage[]>([])
  let streams = $state<Record<string, MediaStream>>({})
  let draft = $state('')

  const localPeer = $derived(peers.find((peer) => peer.isLocal))
  const cameraOn = $derived(Boolean(localPeer?.cameraEnabled))

  const attachStream = (node: HTMLVideoElement, stream: MediaStream): { update: (next: MediaStream) => void; destroy: () => void } => {
    node.srcObject = stream
    return {
      update(next: MediaStream) {
        node.srcObject = next
      },
      destroy() {
        node.srcObject = null
      }
    }
  }

  const autoscroll = (node: HTMLDivElement): { destroy: () => void } => {
    const stop = $effect.root(() => {
      $effect(() => {
        void messages.length
        node.scrollTop = node.scrollHeight
      })
    })
    return { destroy: stop }
  }

  const initial = (name: string): string => {
    const trimmed = name.trim()
    return trimmed ? trimmed[0].toUpperCase() : '?'
  }

  const formatTime = (at: number): string => {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const sendChat = (): void => {
    const text = draft.trim()
    if (!text) return
    window.CallApi.sendChat(text)
    draft = ''
  }

  const onSubmit = (event: SubmitEvent): void => {
    event.preventDefault()
    sendChat()
  }

  onMount(() => {
    const pc = new RTCPeerConnection({ iceServers: [] })
    const pendingIce: RTCIceCandidateInit[] = []
    let mids: CallCameraMid[] = []
    let pendingOffer: RTCSessionDescriptionInit | null = null
    let applyingOffer = false
    const pendingTracks: Array<{ mid: string; stream: MediaStream }> = []

    const applyMappedStream = (mid: string, stream: MediaStream): void => {
      const peerId = mids.find((item) => item.mid === mid)?.peerId
      if (!peerId) {
        pendingTracks.push({ mid, stream })
        return
      }
      streams = { ...streams, [peerId]: stream }
    }

    const flushMappedTracks = (): void => {
      const leftover: Array<{ mid: string; stream: MediaStream }> = []
      for (const item of pendingTracks) {
        const peerId = mids.find((mid) => mid.mid === item.mid)?.peerId
        if (peerId) streams = { ...streams, [peerId]: item.stream }
        else leftover.push(item)
      }
      pendingTracks.length = 0
      pendingTracks.push(...leftover)
    }

    const flushIce = async (): Promise<void> => {
      if (!pc.remoteDescription) return
      const queued = pendingIce.splice(0, pendingIce.length)
      for (const candidate of queued) {
        await pc.addIceCandidate(candidate)
      }
    }

    const applyOffer = async (): Promise<void> => {
      if (applyingOffer) return
      applyingOffer = true
      try {
        while (pendingOffer) {
          const sdp = pendingOffer
          pendingOffer = null
          await pc.setRemoteDescription(sdp)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          window.CallApi.sendAnswer(pc.localDescription ?? answer)
          await flushIce()
        }
      } catch (error) {
        console.error(error)
      } finally {
        applyingOffer = false
      }
    }

    pc.ontrack = (event): void => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      const mid = event.transceiver.mid
      if (mid) applyMappedStream(mid, stream)
    }
    pc.onicecandidate = (event): void => {
      if (event.candidate) window.CallApi.sendIce(event.candidate.toJSON())
    }

    window.CallApi.onChat((next) => {
      messages = next
    })
    window.CallApi.onPeers((next) => {
      peers = next
      const enabled = new Set(next.filter((peer) => peer.cameraEnabled).map((peer) => peer.id))
      const cleaned: Record<string, MediaStream> = {}
      for (const [peerId, stream] of Object.entries(streams)) {
        if (enabled.has(peerId)) cleaned[peerId] = stream
      }
      streams = cleaned
    })
    window.CallApi.onCameraMids((next) => {
      mids = next
      flushMappedTracks()
    })
    window.CallApi.onOffer((sdp) => {
      pendingOffer = sdp
      void applyOffer()
    })
    window.CallApi.onIce((candidate) => {
      if (!pc.remoteDescription) {
        pendingIce.push(candidate)
        return
      }
      void pc.addIceCandidate(candidate)
    })
    window.CallApi.onRequestSync(() => {
      window.CallApi.ready()
    })
    window.CallApi.ready()

    return (): void => {
      pc.close()
    }
  })
</script>

<div class="h-screen flex flex-col bg-base-200 text-base-content">
  <header class="drag flex items-center justify-between px-3 py-2 bg-base-300">
    <span class="font-semibold text-sm">{L.chat()}</span>
    <div class="no-drag flex gap-1">
      <button
        class="btn btn-ghost btn-sm"
        title={cameraOn ? L.camera_on() : L.camera_off()}
        onclick={() => window.CallApi.toggleCamera()}
      >
        <i class="fa-solid {cameraOn ? 'fa-video' : 'fa-video-slash'}"></i>
      </button>
      <button class="btn btn-ghost btn-sm" title={L.leave()} onclick={() => window.close()}>
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </header>

  <section class="grid grid-cols-2 gap-2 p-3">
    {#each peers as peer (peer.id)}
      <div class="rounded-box bg-base-100 p-2 flex flex-col items-center gap-1">
        {#if streams[peer.id]}
          <video class="w-full aspect-video rounded-box object-cover bg-black" autoplay playsinline muted use:attachStream={streams[peer.id]}></video>
        {:else}
          <div
            class="w-full aspect-video rounded-box flex items-center justify-center text-xl font-bold text-white"
            style="background: {peer.color}"
          >
            {initial(peer.name)}
          </div>
        {/if}
        <span class="text-xs truncate w-full text-center">
          {peer.name}{peer.isLocal ? ` (${L.you()})` : ''}
        </span>
      </div>
    {/each}
  </section>

  <div use:autoscroll class="flex-1 overflow-y-auto px-3 pb-2 space-y-2">
    {#each messages as message (message.id)}
      <div class="text-sm">
        <span class="font-semibold">{message.name}</span>
        <span class="opacity-60 text-xs ml-1">{formatTime(message.at)}</span>
        <p class="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    {/each}
  </div>

  <form class="no-drag p-3 pt-0 flex gap-2" onsubmit={onSubmit}>
    <input
      class="input input-bordered input-sm flex-1"
      bind:value={draft}
      placeholder={L.chat_placeholder()}
      maxlength="2000"
    />
    <button class="btn btn-primary btn-sm" type="submit">{L.send()}</button>
  </form>
</div>

<style>
  .drag {
    -webkit-app-region: drag;
  }
  .no-drag {
    -webkit-app-region: no-drag;
  }
</style>
