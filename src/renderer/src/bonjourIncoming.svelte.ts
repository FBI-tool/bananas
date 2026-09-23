import type { IncomingBonjourCall } from './session/bonjourSignal'

class BonjourIncoming {
  call = $state<IncomingBonjourCall | null>(null)
  callerName = $state('')
  callerImage = $state<string | null>(null)
  accept: () => void = () => {}
  reject: () => void = () => {}
}

export const bonjourIncoming = new BonjourIncoming()
