<script lang="ts">
	import '@fortawesome/fontawesome-free/css/all.css';
	import HeadComponent from '$lib/HeadComponent.svelte';

	const handleAnchorClick = (evt: Event) => {
		evt.preventDefault();
		const link = evt.currentTarget as HTMLAnchorElement;
		const anchorId = new URL(link.href).hash.replace('#', '');
		const anchor = document.getElementById(anchorId);
		window.scrollTo({
			top: anchor?.offsetTop,
			behavior: 'smooth'
		});
		window.history.pushState(null, '', `#${anchorId}`);
	};
</script>

<HeadComponent
	data={{
		title: 'p2p.kiwi',
		description:
			'Full E2EE Cross-Platform (MacOS <-> Windows <-> Linux) P2P Mesh Remote Control (Mouse and/or Keyboard).'
	}}
/>
<div id="start" class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-md min-w-0">
			<img src="/logo.png" alt="p2p.kiwi logo" class="m-5 mx-auto w-64" />
			<h1 class="text-5xl font-bold">p2p.kiwi</h1>
			<p class="py-6">
				Full E2EE Cross-Platform (MacOS <nobr>&lt;-&gt;</nobr> Windows <nobr>&lt;-&gt;</nobr> Linux) P2P
				Mesh Remote Control (Mouse and/or Keyboard).
			</p>
			<p class="py-6">There is no p2p.kiwi cloud and no forced accounts.</p>
			<p class="py-6">
				Think of it as <a class="link link-accent" href="https://en.wikipedia.org/wiki/Skype"
					>Skype's</a
				>
				nerdy little sister, but
				<span
					class="tooltip decoration-info text-info underline decoration-dotted"
					data-tip=".. as in end-to-end encrypted">E2EE</span
				>, Chat, Voice, Screenshare, Remote-Controls, a P2P mesh network and completely free and
				open-source.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<a href="/install"><button class="btn btn-accent">Install</button></a>
				<a href="/screenshots"> <button class="btn btn-primary">Screenshots</button></a>
				<a href="/docs"><button class="btn btn-info">Docs</button></a>
			</div>
		</div>
	</div>
</div>
<div id="get-involved" class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-md min-w-0">
			<a href="#get-involved" on:click={handleAnchorClick}>
				<h1 class="text-5xl font-bold">Get involved 📦</h1>
			</a>
			<p class="py-6">p2p.kiwi is open-source and we welcome contributions.</p>
			<p>
				View the <a class="text-secondary" href="https://github.com/dont-be-evil-company/p2p.kiwi"
					>code</a
				>.
			</p>
		</div>
	</div>
</div>

<style>
	details {
		border-radius: 4px;
		padding: 10px;
	}

	summary {
		font-weight: bold;
		cursor: pointer;
		user-select: none;
		margin-bottom: 10px;
	}

	details {
		overflow: hidden;
	}

	details::details-content {
		block-size: 0;
		opacity: 0;
		overflow: hidden;
		border: 5px solid transparent;
		background-color: #181818;
		transition:
			block-size 300ms ease,
			opacity 200ms ease,
			content-visibility 300ms allow-discrete;
	}

	details[open]::details-content {
		block-size: auto;
		opacity: 1;
		border: 5px solid #181818;
		border-radius: 10px;
	}

	details > summary:first-of-type {
		display: list-item;
		list-style: none;
	}

	details > summary:first-of-type:before {
		content: '📚';
		margin-right: 15px;
		display: inline-block;
	}

	details[open] > summary:first-of-type:before {
		content: '📖';
	}

	details p {
		margin: 10px 20px auto 20px;
		font-size: 16px;
	}

	details p.mnemonic {
		font-size: 14px;
	}

	@supports (interpolate-size: allow-keywords) {
		:root {
			interpolate-size: allow-keywords;
		}
	}
</style>
