<script lang="ts">
  import { L } from './translations'
  import type { Room } from './session/room.svelte'

  let { room }: { room: Room } = $props()

  const vote = $derived(room.activeVote)
  const candidate = $derived(room.peers.find((peer) => peer.id === vote?.candidateId))
  const isKick = $derived(vote?.kind === 'kick')
  const isTarget = $derived(Boolean(vote && vote.candidateId === room.localPeerId))
  const showVote = $derived(Boolean(vote && room.localVoteCast === null && !isTarget))
  const showTargetNotice = $derived(Boolean(isKick && isTarget))
</script>

{#if showVote && vote}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg">
        {isKick
          ? L.vote_remove({ name: candidate?.username ?? '' })
          : L.vote_in_progress({ name: candidate?.username ?? '' })}
      </h3>
      <div class="modal-action">
        <button class="btn btn-error" onclick={() => room.castLocalVote(false)}>{L.deny()}</button>
        <button class="btn btn-success" onclick={() => room.castLocalVote(true)}>{L.approve()}</button>
      </div>
    </div>
  </dialog>
{/if}

{#if showTargetNotice}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg">{L.vote_removing_you()}</h3>
    </div>
  </dialog>
{/if}
