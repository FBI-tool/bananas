export type PresenceStatus = 'available' | 'busy' | 'offline'

export const isPresenceStatus = (value: unknown): value is PresenceStatus =>
  value === 'available' || value === 'busy' || value === 'offline'

export const applyContactPresence = <T extends { userId: string; presence: PresenceStatus }>(
  contacts: T[],
  userId: string,
  status: PresenceStatus,
): T[] => {
  let changed = false
  const next = contacts.map((contact) => {
    if (contact.userId !== userId || contact.presence === status) return contact
    changed = true
    return { ...contact, presence: status }
  })
  return changed ? next : contacts
}
