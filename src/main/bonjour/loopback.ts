import { createServer } from 'node:http'

export const startAuthLoopback = (
  onToken: (token: string) => void,
): Promise<{ url: string; close: () => void }> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/bonjour-auth') {
        res.writeHead(404)
        res.end()
        return
      }
      const token = url.searchParams.get('token')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><p>Signed in to Bonjour. You can close this tab and return to p2p.kiwi.</p>',
      )
      if (token) onToken(token)
      server.close()
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('auth loopback failed to bind'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/bonjour-auth`,
        close: () => {
          server.close()
        },
      })
    })
  })
