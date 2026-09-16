import { Room } from './room.svelte'

/** One live room for Host, Join, and Bonjour so view switches cannot drop media. */
export const sessionRoom = new Room()
