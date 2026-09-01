<script lang="ts">
  import { onMount } from 'svelte'
  import ColorPicker from 'svelte-awesome-color-picker'
  import { L } from './translations'

  let colorPreviewIcon: HTMLElement | undefined = $state()
  let usernameValue = $state('Kiwi')
  let colorValue = $state('#ffffff')
  let language = $state('en')
  const languageOptions = ['en', 'de', 'fr', 'pt-br', 'zh']
  let iceServersValue = $state('{ "urls": "stun:stun.l.google.com:19302" }')
  let modalSuccessIsActive = $state(false)
  let modalFailureIsActive = $state(false)
  let isMicrophoneEnabledOnConnect = $state(true)

  const isUsernameValid = $derived(usernameValue.length > 0 && usernameValue.length < 32)
  const isColorValid = $derived(/^#[0-9A-F]{6}$/i.test(colorValue))
  const isIceServersValid = $derived(
    iceServersValue.split('\n').every((serverObject) => {
      try {
        const srv = JSON.parse(serverObject)
        return srv.urls && srv.urls.length > 0
      } catch {
        return false
      }
    })
  )

  $effect(() => {
    if (isColorValid) {
      colorPreviewIcon?.style.setProperty('--color', colorValue)
    }
  })

  async function onSubmit(evt: Event): Promise<void> {
    evt.preventDefault()
    if (isUsernameValid && isColorValid && isIceServersValid) {
      await window.KiwiApi.updateSettings({
        username: usernameValue,
        color: colorValue,
        language,
        isMicrophoneEnabledOnConnect,
        iceServers: iceServersValue.split('\n').map((srv) => JSON.parse(srv))
      })
      modalSuccessIsActive = true
      setTimeout(() => {
        modalSuccessIsActive = false
      }, 2000)
    } else {
      modalFailureIsActive = true
      setTimeout(() => {
        modalFailureIsActive = false
      }, 2000)
    }
  }
  onMount(async () => {
    const settings = await window.KiwiApi.getSettings()
    usernameValue = settings.username
    colorValue = settings.color
    language = settings.language
    isMicrophoneEnabledOnConnect = settings.isMicrophoneEnabledOnConnect
    iceServersValue = settings.iceServers.map((srv) => JSON.stringify(srv)).join('\n')
  })
</script>

<dialog class="modal" class:modal-open={modalSuccessIsActive}>
  <div class="modal-box">
    <h3 class="text-lg font-bold text-success">Success</h3>
    <p>Settings successfully saved.</p>
  </div>
</dialog>

<dialog class="modal" class:modal-open={modalFailureIsActive}>
  <div class="modal-box">
    <h3 class="text-lg font-bold text-error">Failure</h3>
    <p>Settings could not be saved.</p>
  </div>
</dialog>

<div class="container mx-auto p-5">
  <h1 class="text-3xl font-bold mb-4">{L.settings()}</h1>
  <h2 class="text-xl font-semibold mb-2">{L.basic()}</h2>
  <form class="flex flex-col gap-4 max-w-xl" onsubmit={onSubmit}>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">{L.username()}</legend>
      <label class="input w-full {isUsernameValid ? 'input-success' : 'input-error'}">
        <i class="fas fa-user"></i>
        <input bind:value={usernameValue} type="text" id="username" placeholder="Kiwi" />
      </label>
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">{L.color()}</legend>
      <label class="input w-full {isColorValid ? 'input-success' : 'input-error'}">
        <i bind:this={colorPreviewIcon} class="fas fa-palette color-preview"></i>
        <input bind:value={colorValue} type="text" id="color" placeholder="#ffffff" />
      </label>
      <ColorPicker bind:hex={colorValue} isTextInput={false} isAlpha={false} />
    </fieldset>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">{L.language()}</legend>
      <select class="select w-full" bind:value={language}>
        {#each languageOptions as lang}
          <option>{lang}</option>
        {/each}
      </select>
      <p class="label">{L.language_description()}</p>
    </fieldset>

    <h2 class="text-xl font-semibold mt-2">{L.media()}</h2>

    <label class="label cursor-pointer justify-start gap-2">
      <input
        bind:checked={isMicrophoneEnabledOnConnect}
        class="checkbox"
        type="checkbox"
        id="microphone_active_on_connect"
      />
      {L.is_microphone_active_on_connect()}
    </label>

    <h2 class="text-xl font-semibold mt-2">{L.advanced()}</h2>

    <fieldset class="fieldset">
      <legend class="fieldset-legend">{L.stun_turn_server_objects()}</legend>
      <textarea
        bind:value={iceServersValue}
        class="textarea w-full {isIceServersValid ? 'textarea-success' : 'textarea-error'}"
        id="ice_servers"
        placeholder={'{ "urls": "stun:stun.l.google.com:19302" }'}
      ></textarea>
    </fieldset>

    <button class="btn btn-primary w-fit">{L.save()}</button>
  </form>
</div>

<style>
  :global(.color-preview) {
    color: var(--color, #ffffff);
  }
</style>
