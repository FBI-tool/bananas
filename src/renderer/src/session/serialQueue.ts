export type SerialQueue = {
  enqueue(task: () => Promise<void>): void
  reset(): void
}

/** Run async work in enqueue order. A rejected task does not stall later work. */
export const createSerialQueue = (onError?: (error: unknown) => void): SerialQueue => {
  let tail = Promise.resolve()
  return {
    enqueue(task) {
      tail = tail.then(task).catch((error) => {
        onError?.(error)
      })
    },
    reset() {
      tail = Promise.resolve()
    },
  }
}
