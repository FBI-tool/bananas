type TrpcErrorBody = {
  message?: string
  json?: { message?: string; data?: { message?: string } }
  data?: { message?: string }
}

type TrpcResult<T> = { result?: { data: T }; error?: TrpcErrorBody }

export const isClosedStreamError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const err = error as { message?: string; cause?: { message?: string; code?: string } }
  if (err.message === 'closed') return true
  const cause = err.cause
  return cause?.message === 'closed' || cause?.code === 'UND_ERR_SOCKET'
}

export const trpcErrorMessage = (error: TrpcErrorBody | undefined): string => {
  if (!error) return 'bonjour request failed'
  const nested = error.json
  const source = nested ?? error
  if (typeof source.message === 'string' && source.message.trim()) return source.message
  const dataMessage = source.data?.message ?? error.data?.message
  if (typeof dataMessage === 'string' && dataMessage.trim()) return dataMessage
  return 'bonjour request failed'
}

export class TrpcHttp {
  constructor(private baseUrl: string) {}

  private origin(): string {
    return this.baseUrl.replace(/\/$/, '')
  }

  private url(path: string): string {
    return `${this.origin()}/trpc/${path}`
  }

  private headers(token: string): HeadersInit {
    return {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: this.origin(),
    }
  }

  async query<T>(token: string, path: string, input?: unknown): Promise<T> {
    const encoded = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
    const res = await fetch(this.url(path) + encoded, { headers: this.headers(token) })
    return this.read(res)
  }

  async mutate<T>(token: string, path: string, input?: unknown): Promise<T> {
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify(input ?? {}),
    })
    return this.read(res)
  }

  private async read<T>(res: Response): Promise<T> {
    const body = (await res.json()) as TrpcResult<T>
    if (body.error) {
      throw new Error(trpcErrorMessage(body.error))
    }
    const data = body.result?.data as T | { json: T } | undefined
    if (data && typeof data === 'object' && 'json' in data) return (data as { json: T }).json
    return data as T
  }
}
