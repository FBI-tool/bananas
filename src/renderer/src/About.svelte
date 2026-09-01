<script lang="ts">
  import { L } from './translations'
  import { externalLinkClickHandler } from './Utils'
  import shoulders from './About.shoulders-of-giants.json'

  const randomizedShoulders = shoulders.sort(() => Math.random() - 0.5)

  let version = $state('')
  void (async (): Promise<void> => {
    version = await window.KiwiApi.getAppVersion()
  })()

  const GITHUB_REPO_URL = 'https://github.com/dont-be-evil-company/p2p.kiwi'

  function openExternalURL(e: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    const url = e.currentTarget.dataset.url
    if (!url) return

    externalLinkClickHandler(e.currentTarget, url)
  }
</script>

<div class="container mx-auto p-5">
  <h1 class="text-3xl font-bold mb-4">{L.about()}</h1>
  <p>You are using <code class="bg-base-200 px-1 rounded">{version}</code> of p2p.kiwi Screen Sharing</p>
  <div class="divider"></div>

  <div class="flex flex-wrap gap-2">
    <button class="btn btn-ghost" data-url="https://p2p.kiwi" onclick={openExternalURL}>
      <span class="icon">
        <i class="fa-solid fa-globe"></i>
      </span>
      <strong>{L.website()}</strong>
    </button>
    <button class="btn btn-ghost" data-url="{GITHUB_REPO_URL}/issues/new" onclick={openExternalURL}>
      <span class="icon">
        <i class="fa-solid fa-bug"></i>
      </span>
      <strong>{L.report_a_bug()}</strong>
    </button>
    <button class="btn btn-ghost" data-url={GITHUB_REPO_URL} onclick={openExternalURL}>
      <span class="icon">
        <i class="fa-solid fa-code"></i>
      </span>
      <strong>{L.see_the_code()}</strong>
    </button>
    <button
      class="btn btn-ghost"
      data-url="{GITHUB_REPO_URL}/blob/main/PRIVACY.md"
      onclick={openExternalURL}
    >
      <span class="icon">
        <i class="fa-solid fa-lock"></i>
      </span>
      <strong>{L.privacty_policy()}</strong>
    </button>
    <button
      class="btn btn-ghost"
      data-url="{GITHUB_REPO_URL}/blob/main/TOS.md"
      onclick={openExternalURL}
    >
      <span class="icon">
        <i class="fa-solid fa-book"></i>
      </span>
      <strong>{L.terms_of_service()}</strong>
    </button>
    <button
      class="btn btn-ghost"
      data-url="{GITHUB_REPO_URL}/blob/main/CODE_OF_CONDUCT.md"
      onclick={openExternalURL}
    >
      <span class="icon">
        <i class="fa-solid fa-heart"></i>
      </span>
      <strong>{L.code_of_conduct()}</strong>
    </button>
  </div>
  <div class="divider"></div>
  <h2 class="text-xl font-semibold mb-2">{L.shoulders_of_giants()}</h2>
  <p class="mb-4">
    {L.shoulders_of_giants_description()}
  </p>
  <ul class="list">
    {#each randomizedShoulders as shoulder}
      <li class="mb-4">
        <p>
          <a href={shoulder.url} target="_blank" rel="noopener" class="link link-primary">
            <strong>{shoulder.title}</strong>
            {shoulder.license ? '- ' + shoulder.license : ''}
          </a>
        </p>
        <p>{shoulder.description}</p>
        <p>{shoulder.usage}</p>
        <div class="divider"></div>
      </li>
    {/each}
  </ul>
</div>
