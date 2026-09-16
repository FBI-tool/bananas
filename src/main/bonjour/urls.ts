export const BONJOUR_AUTH_PREFIX = 'kiwi://bonjour-auth'

export const isBonjourAuthUrl = (url: string): boolean =>
  url.startsWith(BONJOUR_AUTH_PREFIX) || url.startsWith('kiwi://bonjour/callback')

export const isKiwiSdpUrl = (url: string): boolean => {
  if (!url.startsWith('kiwi://') && !url.startsWith('bananas://')) return false
  return !isBonjourAuthUrl(url)
}

export const tokenFromBonjourAuthUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('token')
  } catch {
    const match = /[?&]token=([^&]+)/.exec(url)
    return match ? decodeURIComponent(match[1]) : null
  }
}
