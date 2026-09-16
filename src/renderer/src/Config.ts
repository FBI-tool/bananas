type IceServer = {
  urls: string
  username?: string
  credential?: string
}

type PeerConnectionConfig = RTCConfiguration & {
  encodedInsertableStreams?: boolean
}

export const buildRtcPeerConnectionConfig = (
  iceServers: IceServer[],
  encodedInsertableStreams: boolean,
): PeerConnectionConfig => ({
  iceServers,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  ...(encodedInsertableStreams ? { encodedInsertableStreams: true } : {}),
})

export const getRTCPeerConnectionConfig = async (opts?: {
  encodedInsertableStreams?: boolean
}): Promise<PeerConnectionConfig> => {
  const settings = await window.KiwiApi.getSettings()
  const iceServers = settings.iceServers.map((server: IceServer) => {
    return {
      urls: server.urls,
      username: server.username,
      credential: server.credential,
    }
  })
  const encodedInsertableStreams = opts?.encodedInsertableStreams ?? settings.e2eeEnabled !== false
  return buildRtcPeerConnectionConfig(iceServers, encodedInsertableStreams)
}
