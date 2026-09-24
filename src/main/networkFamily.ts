import os from 'os'

const isRoutableIpv6Address = (address: string): boolean => {
  const normalized = address.toLowerCase()
  if (normalized === '::1') return false
  if (normalized.startsWith('fe80:')) return false
  return normalized.includes(':')
}

export const hasRoutableIpv6 = (): boolean => {
  const nets = os.networkInterfaces()
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (addr.internal) continue
      const family = addr.family as string | number
      if (family !== 'IPv6' && family !== 6) continue
      if (isRoutableIpv6Address(addr.address)) return true
    }
  }
  return false
}
