import { afterEach, describe, expect, it, vi } from 'vitest'
import { appState } from '../appState.svelte'
import { recoverFailedConnection } from './recoverFailedConnection'
import { sessionRoom } from './sessionStore.svelte'

describe('recoverFailedConnection', () => {
  const disconnect = sessionRoom.Disconnect

  afterEach(() => {
    sessionRoom.Disconnect = disconnect
    appState.navigationEnabled = true
    appState.isHosting = false
    appState.isWatching = false
    appState.isCoordinator = false
    appState.clearSession()
    delete (globalThis as { window?: unknown }).window
  })

  it('resets the registered session before tearing the room down', async () => {
    const order: string[] = []
    appState.navigationEnabled = false
    appState.isHosting = true
    appState.beginSession('host', () => {
      order.push('reset')
      appState.navigationEnabled = true
      appState.isHosting = false
      appState.clearSession()
    })

    sessionRoom.Disconnect = async (): Promise<void> => {
      order.push('disconnect')
    }

    recoverFailedConnection()
    await Promise.resolve()

    expect(order).toEqual(['reset', 'disconnect'])
    expect(appState.navigationEnabled).toBe(true)
    expect(appState.sessionSource).toBeNull()
    expect(appState.isHosting).toBe(false)
  })

  it('tears the room down and leaves navigation enabled', async () => {
    const toggles: boolean[] = []
    ;(globalThis as { window?: unknown }).window = {
      KiwiApi: {
        toggleRemoteCursors: (enabled: boolean) => {
          toggles.push(enabled)
        },
      },
    }

    appState.navigationEnabled = false
    appState.isHosting = true
    appState.beginSession('host', () => {
      appState.navigationEnabled = true
      appState.isHosting = false
      appState.isCoordinator = false
      appState.clearSession()
    })
    sessionRoom.connectionState = 'failed'
    sessionRoom.isLive = true

    recoverFailedConnection()
    await vi.waitFor(() => {
      expect(sessionRoom.connectionState).toBe('disconnected')
    })

    expect(appState.navigationEnabled).toBe(true)
    expect(appState.sessionSource).toBeNull()
    expect(appState.isHosting).toBe(false)
    expect(sessionRoom.isLive).toBe(false)
    expect(toggles).toEqual([false])
  })
})
