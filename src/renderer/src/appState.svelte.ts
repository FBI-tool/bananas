import type { ViewName } from './types'

class AppState {
  activeView = $state<ViewName>('join')
  navigationEnabled = $state(true)
  isHosting = $state(false)
  isWatching = $state(false)
  isCoordinator = $state(false)
  hostUrl = $state('')
  participantUrl = $state('')
}

export const appState = new AppState()
