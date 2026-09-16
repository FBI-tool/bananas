import { describe, expect, it } from 'vitest'
import { appState } from './appState.svelte'

describe('appState', () => {
  it('starts on the join view', () => {
    expect(appState.activeView).toBe('join')
    expect(appState.navigationEnabled).toBe(true)
    expect(appState.isHosting).toBe(false)
    expect(appState.isWatching).toBe(false)
    expect(appState.isCoordinator).toBe(false)
  })

  it('updates view and session flags', () => {
    appState.activeView = 'host'
    appState.isHosting = true
    appState.navigationEnabled = false
    appState.hostUrl = 'kiwi://host?username=Kiwi&token=abc'

    expect(appState.activeView).toBe('host')
    expect(appState.isHosting).toBe(true)
    expect(appState.navigationEnabled).toBe(false)
    expect(appState.hostUrl).toContain('kiwi://')

    appState.activeView = 'join'
    appState.isHosting = false
    appState.navigationEnabled = true
    appState.hostUrl = ''
  })

  it('hides bonjour until enabled', () => {
    expect(appState.bonjourEnabled).toBe(false)
    appState.bonjourEnabled = true
    expect(appState.bonjourEnabled).toBe(true)
    appState.bonjourEnabled = false
  })
})
