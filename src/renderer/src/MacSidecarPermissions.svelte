<script lang="ts">
  import { onMount } from 'svelte'
  import { L } from './translations'
  import { externalLinkClickHandler } from './Utils'

  type Permission = 'unknown' | 'granted' | 'denied' | 'unavailable' | 'restart-required'

  type Caps = {
    permissions?: {
      accessibility?: Permission
      inputMonitoring?: Permission
    }
  }

  let {
    caps = null,
    onRequest,
  }: {
    caps?: Caps | null
    onRequest?: (capability: 'post' | 'listen') => Promise<void>
  } = $props()

  let localCaps = $state<Caps | null>(null)
  let fetched = $state<Caps | null>(null)
  const shown = $derived(fetched ?? caps ?? localCaps)
  const post = $derived(shown?.permissions?.accessibility ?? 'unknown')
  const listen = $derived(shown?.permissions?.inputMonitoring ?? 'unknown')
  const restart = $derived(post === 'restart-required' || listen === 'restart-required')

  const ACCESSIBILITY_URL =
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  const LISTEN_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'

  const refresh = async (): Promise<void> => {
    const next =
      (await window.KiwiApi.remoteControl?.recheck?.()) ??
      (await window.KiwiApi.remoteControl?.getCapabilities?.()) ??
      null
    fetched = next
    localCaps = next
  }

  onMount(() => {
    if (!caps) void refresh()
  })

  const request = async (capability: 'post' | 'listen'): Promise<void> => {
    if (onRequest) await onRequest(capability)
    else await window.KiwiApi.remoteControl?.requestPermission?.(capability)
    await refresh()
  }

  const openSettings = (event: MouseEvent & { currentTarget: HTMLButtonElement }): void => {
    const url = event.currentTarget.dataset.url
    if (!url) return
    externalLinkClickHandler(event.currentTarget, url)
  }
</script>

<div class="flex flex-col gap-2">
  <p>{L.remote_control_permission_helper()}</p>
  <p>
    Accessibility: {post}. Input Monitoring: {listen}.
  </p>
  {#if restart}
    <p>{L.remote_control_restart_required()}</p>
  {/if}
  <div class="flex flex-wrap gap-2">
    {#if post !== 'granted'}
      <button class="btn btn-sm" type="button" onclick={() => request('post')}>
        {L.remote_control_request_permission()}
      </button>
      <button class="btn btn-sm" type="button" data-url={ACCESSIBILITY_URL} onclick={openSettings}>
        {L.remote_control_open_accessibility()}
      </button>
    {/if}
    {#if listen !== 'granted' && listen !== 'unavailable'}
      <button class="btn btn-sm" type="button" onclick={() => request('listen')}>
        {L.remote_control_request_listen()}
      </button>
      <button class="btn btn-sm" type="button" data-url={LISTEN_URL} onclick={openSettings}>
        {L.remote_control_open_input_monitoring()}
      </button>
    {/if}
    <button class="btn btn-sm btn-ghost" type="button" onclick={() => refresh()}>
      {L.remote_control_recheck()}
    </button>
  </div>
</div>
