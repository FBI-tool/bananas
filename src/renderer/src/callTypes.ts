export type CallChatMessage = {
  id: string
  from: string
  name: string
  text: string
  at: number
}

export type CallPeerInfo = {
  id: string
  name: string
  foregroundColor: string
  backgroundColor: string
  cameraEnabled: boolean
  isLocal: boolean
}

export type CallCameraMid = {
  mid: string
  peerId: string
}
