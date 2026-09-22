import type { IncomingBonjourCall } from './session/bonjourSignal'

class BonjourIncoming {
  call = $state<IncomingBonjourCall | null>(null)
  callerName = $state('')
  accept: () => void = () => {}
  reject: () => void = () => {}
}

export const bonjourIncoming = new BonjourIncoming()
