import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrpcHttp, isClosedStreamError, trpcErrorMessage } from './trpc'

describe('trpcErrorMessage', () => {
  it('reads tRPC 11 flat errors and wrapped json errors', () => {
    expect(trpcErrorMessage({ message: 'username taken' })).toBe('username taken')
    expect(trpcErrorMessage({ json: { message: 'username contains invalid characters' } })).toBe(
      'username contains invalid characters',
    )
    expect(trpcErrorMessage({ data: { message: 'UNAUTHORIZED' } })).toBe('UNAUTHORIZED')
    expect(trpcErrorMessage({})).toBe('bonjour request failed')
  })
})

describe('isClosedStreamError', () => {
  it('matches a body read closed by the peer', () => {
    expect(isClosedStreamError(new Error('closed'))).toBe(true)
    expect(isClosedStreamError(new Error('closed', { cause: new Error('closed') }))).toBe(true)
    expect(
      isClosedStreamError(
        new Error('terminated', { cause: { message: 'closed', code: 'UND_ERR_SOCKET' } }),
      ),
    ).toBe(true)
    expect(isClosedStreamError(new Error('username taken'))).toBe(false)
  })
})

describe('TrpcHttp', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts mutation input as raw JSON, not a json envelope', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { data: { username: 'kiwi' } } }), {
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const http = new TrpcHttp('http://localhost')
    await expect(
      http.mutate('tok', 'account.claimUsername', { username: 'kiwi' }),
    ).resolves.toEqual({ username: 'kiwi' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ username: 'kiwi' })
    const headers = new Headers(init.headers)
    expect(headers.get('origin')).toBe('http://localhost')
    expect(headers.get('authorization')).toBe('Bearer tok')
  })

  it('surfaces tRPC 11 error messages from mutations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'username taken', code: -32009 } }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const http = new TrpcHttp('http://localhost')
    await expect(http.mutate('tok', 'account.claimUsername', { username: 'kiwi' })).rejects.toThrow(
      'username taken',
    )
  })
})
