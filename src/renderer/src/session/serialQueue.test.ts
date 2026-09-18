import { describe, expect, it, vi } from 'vitest'
import { createSerialQueue } from './serialQueue'

const drain = (queue: ReturnType<typeof createSerialQueue>): Promise<void> =>
  new Promise((resolve) => {
    queue.enqueue(async () => {
      resolve()
    })
  })

describe('createSerialQueue', () => {
  it('runs later tasks only after earlier work finishes', async () => {
    const order: number[] = []
    const queue = createSerialQueue()
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    queue.enqueue(async () => {
      await firstGate
      order.push(1)
    })
    queue.enqueue(async () => {
      order.push(2)
    })
    await Promise.resolve()
    expect(order).toEqual([])
    releaseFirst()
    await drain(queue)
    expect(order).toEqual([1, 2])
  })

  it('keeps enqueue order when a later task would otherwise finish first', async () => {
    const order: number[] = []
    const queue = createSerialQueue()
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    queue.enqueue(async () => {
      await firstGate
      order.push(1)
    })
    queue.enqueue(async () => {
      order.push(2)
    })
    queue.enqueue(async () => {
      order.push(3)
    })
    await Promise.resolve()
    expect(order).toEqual([])
    releaseFirst()
    await drain(queue)
    expect(order).toEqual([1, 2, 3])
  })

  it('does not stall after a rejected task', async () => {
    const order: number[] = []
    const onError = vi.fn()
    const queue = createSerialQueue(onError)
    queue.enqueue(async () => {
      order.push(1)
      throw new Error('encrypt failed')
    })
    queue.enqueue(async () => {
      order.push(2)
    })
    await drain(queue)
    expect(order).toEqual([1, 2])
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
