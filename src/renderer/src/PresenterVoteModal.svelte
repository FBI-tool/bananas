<script lang="ts">
  import { L } from './translations'
  import type { Room } from './session/room.svelte'

  let { room }: { room: Room } = $props()

  const candidate = $derived(room.peers.find((peer) => peer.id === room.activeVote?.candidateId))
  const showModal = $derived(
    Boolean(room.activeVote && room.activeVote.candidateId !== room.localPeerId && room.localVoteCast === null)
  )
</script>

{#if showModal && room.activeVote}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg">{L.vote_in_progress({ name: candidate?.username ?? '' })}</h3>
      <div class="modal-action">
        <button class="btn btn-error" onclick={() => room.castLocalVote(false)}>{L.deny()}</button>
        <button class="btn btn-success" onclick={() => room.castLocalVote(true)}>{L.approve()}</button>
      </div>
    </div>
  </dialog>
{/if}
