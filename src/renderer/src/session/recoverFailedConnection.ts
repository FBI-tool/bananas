import { appState } from '../appState.svelte'
import { sessionRoom } from './sessionStore.svelte'

/** Return to the idle screen after a connection that never became live. */
export const recoverFailedConnection = (): void => {
  appState.resetSession()
  void sessionRoom.Disconnect()
}
