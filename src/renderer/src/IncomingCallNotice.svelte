<script lang="ts">
  import { onDestroy } from 'svelte'
  import { L } from './translations'
  import { bonjourIncoming } from './bonjourIncoming.svelte'
  import { syncIncomingRing } from './session/incomingCallSound'

  let imageBroken = $state(false)

  $effect(() => {
    bonjourIncoming.callerImage
    imageBroken = false
  })

  $effect(() => {
    syncIncomingRing(bonjourIncoming.call?.callId ?? null)
  })

  onDestroy(() => {
    syncIncomingRing(null)
  })
</script>

{#if bonjourIncoming.call}
  <div class="toast z-50">
    <div class="alert alert-soft">
      <div class="hero min-w-0 max-w-full">
        <div class="hero-content flex-col lg:flex-row">
          <div class="avatar avatar-online {bonjourIncoming.callerImage && !imageBroken ? '' : 'avatar-placeholder'}">
            <div class="bg-neutral text-neutral-content w-16 rounded-full">
              {#if bonjourIncoming.callerImage && !imageBroken}
                <img
                  src={bonjourIncoming.callerImage}
                  alt=""
                  onerror={() => {
                    imageBroken = true
                  }}
                />
              {:else}
                <i class="fa-solid fa-phone text-2xl"></i>
              {/if}
            </div>
          </div>
          <div>
            <h1 class="text-xl font-bold">{L.bonjour_incoming_call()}</h1>
            <p class="py-6">
              {bonjourIncoming.callerName}
            </p>
            <button class="btn btn-success" onclick={() => bonjourIncoming.accept()}>{L.approve()}</button>
            <button class="btn btn-error" onclick={() => bonjourIncoming.reject()}>{L.deny()}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
