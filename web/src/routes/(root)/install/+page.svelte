<script lang="ts">
	import HeadComponent from '$lib/HeadComponent.svelte';
	import CodeBlock from '$lib/CodeBlock.svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { redirect } from '@sveltejs/kit';
	const installSystems = [
		{
			name: 'Linux',
			value: 'linux'
		},
		{
			name: 'MacOS',
			value: 'macos'
		},
		{
			name: 'Windows',
			value: 'windows'
		},
		{
			name: 'manual',
			value: 'manual'
		}
	] as const;
	type InstallSystem = (typeof installSystems)[number]['value'];
	let installSystem: InstallSystem = 'linux';
	const isValidInstallSystem = (value: string): value is InstallSystem => {
		return installSystems.some((system) => system.value === value);
	};
	let form: HTMLFormElement;
	const onInstallSystemChange = () => {
		if (!browser) return;
		const formData = new FormData(form);
		const typeParam = formData.get('type');
		if (typeParam && typeof typeParam === 'string' && isValidInstallSystem(typeParam)) {
			installSystem = typeParam;
			const url = new URL(window.location.href);
			url.searchParams.set('type', typeParam);
			window.history.replaceState({}, '', url.toString());
		}
	};
	onMount(() => {
		if (!browser) return;
		const urlParams = new URLSearchParams(window.location.search);
		const typeParam = urlParams.get('type');
		if (typeParam && !installSystems.some((system) => system.value === typeParam)) {
			redirect(302, '/install?type=unix');
		}
		if (typeParam && typeof typeParam === 'string' && isValidInstallSystem(typeParam)) {
			installSystem = typeParam;
		} else {
			installSystem = 'linux';
		}
	});
</script>

<HeadComponent
	data={{
		title: 'Install · p2p.kiwi',
		description:
			'p2p.kiwi install: Install p2p.kiwi via homebrew, Arch-Linux User Repository, or manually.'
	}}
/>

<div id="install" class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-md min-w-0">
			<a href="/">
				<img src="/logo.png" alt="p2p.kiwi logo" class="m-5 mx-auto w-32" />
			</a>
			<h1 class="text-5xl font-bold">Install ⚡</h1>
			<p class="py-6">Install p2p.kiwi via ...</p>
			<form method="GET" bind:this={form}>
				<select name="type" on:input={onInstallSystemChange} class="select select-bordered mb-5">
					{#each installSystems as system}
						<option value={system.value} selected={installSystem === system.value}
							>{system.name}</option
						>
					{/each}
				</select>
			</form>
			<div class={installSystem === 'linux' ? '' : 'hidden'}>
				<p class="mb-5">Linux:</p>
				<div class="text-left">
					<CodeBlock lang="sh" code={`brew install --cask p2p-kiwi`} />
				</div>
			</div>
			<div class={installSystem === 'macos' ? '' : 'hidden'}>
				<p class="mb-5">MacOS:</p>
				<div class="text-left">
					<CodeBlock lang="sh" code={`brew install --cask p2p-kiwi`} />
				</div>
			</div>
			<div class={installSystem === 'windows' ? '' : 'hidden'}>
				<p class="mb-5">Windows (PowerShell):</p>
				<div class="text-left">
					<CodeBlock lang="powershell" code={`iwr https://remnix.app/install.ps1 -useb | iex`} />
				</div>
				<p class="mb-5">Update later with <code>remnix update</code>.</p>
			</div>
			<div class={installSystem === 'manual' ? '' : 'hidden'}>
				<p class="mb-5">
					Download the latest release from the <a class="text-secondary" href="/download"
						>releases page</a
					>.
				</p>
			</div>
			<div class={installSystem === 'aur' ? '' : 'hidden'}>
				<p class="mb-5">
					Via AUR, using an AUR helper like <a
						href="https://github.com/Jguer/yay"
						class="text-secondary">yay</a
					>
				</p>
				<div class="text-left">
					<CodeBlock lang="sh" code={`yay -S remnix-bin`} />
				</div>
				<p class="mt-5 mb-5">
					.. or via <a href="https://github.com/morganamilo/paru" class="text-secondary">paru</a>
				</p>
				<div class="text-left">
					<CodeBlock lang="sh" code={`paru -S remnix-bin`} />
				</div>
			</div>
			<p>
				<a href="/"><button class="btn btn-primary mt-8">Back home</button></a>
			</p>
		</div>
	</div>
</div>
